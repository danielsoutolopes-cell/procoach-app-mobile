import { Router, type IRouter } from "express";
import healthRouter from "./health";
import procoachRouter from "./procoach";
import authRouter from "./auth";
import stravaRouter from "./strava";
import telegramRouter from "./telegram";
import aiWorkoutRouter from "./ai-workout";
import spotifyRouter from "./spotify";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stravaRouter);
router.use(telegramRouter);
router.use(procoachRouter);
router.use(aiWorkoutRouter);
router.use(spotifyRouter);

export default router;
