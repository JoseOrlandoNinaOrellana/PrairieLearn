// @ts-check
import { Router } from 'express';

const router = Router();

router.get('/', function (req, res, next) {
  if (res.locals.assessment.type !== 'Exam') return next();

  var retval = {
    serverRemainingMS: res.locals.assessment_instance_remaining_ms,
    serverTimeLimitMS: res.locals.assessment_instance_time_limit_ms,
  };
  res.send(JSON.stringify(retval));
});

export default router;
