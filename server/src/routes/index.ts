import { Router } from 'express';
import aiRoutes from './ai';
import meRoutes from './me';
import profileRoutes from './profile';
import goalsRoutes from './goals';
import foodRoutes from './food';
import activityRoutes from './activity';
import bodyRoutes from './body';
import summaryRoutes from './summary';
import trendsRoutes from './trends';
import dataSourcesRoutes from './dataSources';
import analyticsRoutes from './analytics';
import authRoutes from './auth';
import { attachUser } from '../lib/currentUser';

const router = Router();

// 鉴权:Bearer 令牌解析为 res.locals.userId;auth 路由本身不依赖登录态
router.use(attachUser);
router.use('/auth', authRoutes);

router.use('/ai', aiRoutes);
router.use('/me', meRoutes);
router.use('/profile', profileRoutes);
router.use('/goals', goalsRoutes);
router.use('/food-logs', foodRoutes);
router.use('/activities', activityRoutes);
router.use('/body-measurements', bodyRoutes);
router.use('/daily-summary', summaryRoutes);
router.use('/trends', trendsRoutes);
router.use('/data-sources', dataSourcesRoutes);
router.use('/analytics', analyticsRoutes);

export default router;
