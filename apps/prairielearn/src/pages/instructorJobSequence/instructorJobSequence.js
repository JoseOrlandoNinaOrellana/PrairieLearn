// @ts-check
import { Router } from 'express';
import asyncHandler from 'express-async-handler';

import { HttpStatusError } from '@prairielearn/error';

import { getJobSequenceWithFormattedOutput } from '../../lib/server-jobs.js';

const router = Router();

router.get(
  '/:job_sequence_id',
  asyncHandler(async (req, res) => {
    const job_sequence_id = req.params.job_sequence_id;
    const course_id = res.locals.course?.id ?? null;
    const job_sequence = await getJobSequenceWithFormattedOutput(job_sequence_id, course_id);

    // Verify existence of authz_data, which means that we are accessing the
    // job sequence through a course or a course instance. (The only way for
    // this not to be the case is if we are in devMode.)
    if (res.locals.authz_data) {
      // Some job sequences show information that should only be available to
      // users who can view code (Course role: Viewer) or who can view student
      // data (Course instance role: Student Data Viewer).

      if (job_sequence.course_instance_id == null) {
        // If course_instance_id is null, then this job_sequence likely has
        // something to do with code.

        if (!res.locals.authz_data.has_course_permission_view) {
          throw new HttpStatusError(403, 'Access denied (must be a Viewer in the course)');
        }
      } else {
        // If course_instance_id is not null, then this job sequence likely
        // has something to do with student data.

        if (!res.locals.course_instance) {
          // The user is trying to access a job sequence that is associated with
          // a course instance through a course page route. Redirect to the course
          // instance page route so we get authz_data for the course instance.
          res.redirect(
            `${res.locals.plainUrlPrefix}/course_instance/${job_sequence.course_instance_id}/instructor/jobSequence/${job_sequence.id}`,
          );
        }

        if (!res.locals.authz_data.has_course_instance_permission_view) {
          throw new HttpStatusError(
            403,
            'Access denied (must be a Student Data Viewer in the course instance)',
          );
        }
      }
    }

    res.locals.job_sequence = job_sequence;
    res.render(import.meta.filename.replace(/\.js$/, '.ejs'), res.locals);
  }),
);

export default router;
