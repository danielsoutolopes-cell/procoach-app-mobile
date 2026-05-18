import { Router, type IRouter } from "express";
import healthRouter from "./health";
import procoachRouter from "./procoach";
import authRouter from "./auth";
import racesRouter from "./races";
import planRouter from "./plan";
import inventoryRouter from "./inventory";
import bioRouter from "./bio";
import strengthRouter from "./strength";
import reportsRouter from "./reports";
import stravaRouter from "./strava";
import telegramRouter from "./telegram";
import aiWorkoutRouter from "./ai-workout";
import spotifyRouter from "./spotify";
import { stravaWebhookRouter } from "./stravaWebhook";
import procoachLegacyRouter from "./procoach-legacy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(stravaRouter);
router.use(racesRouter);
router.use(planRouter);
router.use(inventoryRouter);
router.use(bioRouter);
router.use(strengthRouter);
router.use(reportsRouter);
router.use(telegramRouter);
router.use(procoachRouter);
router.use(aiWorkoutRouter);
router.use(procoachLegacyRouter);
router.use(spotifyRouter);
router.use(stravaWebhookRouter);

export default router;
