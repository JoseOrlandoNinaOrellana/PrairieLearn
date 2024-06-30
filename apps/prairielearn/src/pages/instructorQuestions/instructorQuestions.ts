import * as path from 'path';

import axios from 'axios';
import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import fs from 'fs-extra';

import * as error from '@prairielearn/error';
import * as sqldb from '@prairielearn/postgres';

import { QuestionAddEditor, FileUploadEditor } from '../../lib/editors.js';
import { getPaths } from '../../lib/instructorFiles.js';
import { selectCourseInstancesWithStaffAccess } from '../../models/course-instances.js';
import { QuestionsPageDataAnsified, selectQuestionsForCourse } from '../../models/questions.js';

import { QuestionsPage } from './instructorQuestions.html.js';

const router = Router();
const sql = sqldb.loadSqlEquiv(import.meta.url);

router.get(
  '/',
  asyncHandler(async function (req, res) {
    const courseInstances = await selectCourseInstancesWithStaffAccess({
      course_id: res.locals.course.id,
      user_id: res.locals.user.user_id,
      authn_user_id: res.locals.authn_user.user_id,
      is_administrator: res.locals.is_administrator,
      authn_is_administrator: res.locals.authz_data.authn_is_administrator,
    });

    const questions: QuestionsPageDataAnsified[] = await selectQuestionsForCourse(
      res.locals.course.id,
      courseInstances.map((ci) => ci.id),
    );

    const courseDirExists = await fs.pathExists(res.locals.course.path);
    res.send(
      QuestionsPage({
        questions,
        course_instances: courseInstances,
        showAddQuestionButton:
          res.locals.authz_data.has_course_permission_edit &&
          !res.locals.course.example_course &&
          courseDirExists,
        resLocals: res.locals,
      }),
    );
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const paths = getPaths(req, res);
    const container = {
      rootPath: paths.rootPath,
      invalidRootPaths: [],
    };

    if (req.body.__action === 'add_question') {
      console.log(req.body);
      if (!req.body.title) {
        res.status(400).json({ message: 'Title is required' });
        return;
      }
      const title = req.body.title;

      if (!req.body.id) {
        res.status(400).json({ message: `Invalid TID (was falsy): ${req.body.id}` });
        return;
      }
      if (!/^[-A-Za-z0-9_/]+$/.test(req.body.id)) {
        res.status(400).json({
          message: `Invalid TID (was not only letters, numbers, dashes, slashes, and underscores, with no spaces): ${req.body.id}`,
        });
        return;
      }

      let qid;
      try {
        qid = path.normalize(req.body.id);
      } catch (err) {
        res.status(400).json({
          message: `Invalid TID (could not be normalized): ${req.body.id}`,
        });
        return;
      }

      const questionAddEditor = new QuestionAddEditor({
        locals: res.locals,
        qid,
        title,
      });
      const questionAddServerJob = await questionAddEditor.prepareServerJob();
      try {
        await questionAddEditor.executeWithServerJob(questionAddServerJob);
      } catch (err) {
        res.redirect(res.locals.urlPrefix + '/edit_error/' + questionAddServerJob.jobSequenceId);
        return;
      }

      await sqldb.queryOneRowAsync(sql.select_question_id_from_uuid, {
        uuid: questionAddEditor.uuid,
        course_id: res.locals.course.id,
      });

      if (req.file) {
        const questionPath = questionAddEditor.pathsToAdd?.[0] || '';
        const solutionFileName = 'solution.cpp';

        let solutionFilePath;
        try {
          solutionFilePath = path.join(questionPath, solutionFileName);
        } catch (err) {
          res.status(400).json({
            message: `Invalid solution file path: ${questionPath}/${solutionFileName}`,
          });
          return;
        }
        const solutionFileUploadEditor = new FileUploadEditor({
          locals: res.locals,
          container,
          filePath: solutionFilePath,
          fileContents: req.file.buffer,
        });

        const solutionFileUploadServerJob = await solutionFileUploadEditor.prepareServerJob();
        try {
          await solutionFileUploadEditor.executeWithServerJob(solutionFileUploadServerJob);
        } catch (err) {
          res.redirect(
            res.locals.urlPrefix + '/edit_error/' + solutionFileUploadServerJob.jobSequenceId,
          );
          return;
        }

        // Generate tests
        let formData;
        const code = req.file?.buffer.toString('utf8') || '';
        if (req.body.aiActivated === 'on') {
          formData = {
            model: 'test-generator',
            prompt: code,
            stream: false,
          };
        } else {
          formData = new FormData();
          formData.append('code', code);
        }

        try {
          let response;
          let test;
          if (req.body.aiActivated === 'on') {
            response = await axios.post('http://ollama:11434/api/generate', formData, {
              headers: { 'Content-Type': 'application/json' },
            });

            test = response.data.response;
            const regex = /\[TESTS\](.*?)\[\/TESTS\]/s;
            const match = test.match(regex);

            if (match && match[1]) {
              test = match[1];
              console.log(test);
            } else {
              res.status(500).json({ message: 'Error generating tests' });
              return;
            }
          } else {
            response = await axios.post('http://tg:3030/generate', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            test = response.data;
          }

          console.log(response.data);
          const testFolderName = 'tests';
          const testFileName = 'test.cpp';

          let testFilePath;
          try {
            testFilePath = path.join(questionPath, testFolderName, testFileName);
          } catch (err) {
            res.status(400).json({
              message: `Invalid test file path: ${questionPath}/${testFolderName}/${testFileName}`,
            });
            return;
          }
          const testFileUploadEditor = new FileUploadEditor({
            locals: res.locals,
            container,
            filePath: testFilePath,
            fileContents: test,
          });

          const testFileUploadServerJob = await testFileUploadEditor.prepareServerJob();
          try {
            await testFileUploadEditor.executeWithServerJob(testFileUploadServerJob);
          } catch (err) {
            res.redirect(
              res.locals.urlPrefix + '/edit_error/' + testFileUploadServerJob.jobSequenceId,
            );
            return;
          }
          res.status(200).json({ message: 'Question created successfully with tests' });
        } catch (err) {
          console.error(err);
          res.status(500).json({ message: 'Error generating tests' });
          return;
        }
      } else {
        res.status(200).json({ message: 'Question created successfully' });
      }
    } else {
      throw new error.HttpStatusError(400, `unknown __action: ${req.body.__action}`);
    }
  }),
);

export default router;
