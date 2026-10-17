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
import waterRoutes from './water';
import trainingRoutes from './training';
import reminderRoutes from './reminder';
import { attachUser } from '../lib/currentUser';

const router = Router();

/**
 * 登录路由必须挂在鉴权中间件**之前**。
 *
 * attachUser 在生产环境对无令牌请求直接 401,而登录请求本来就没有令牌 ——
 * 挂后面会变成「要先登录才能登录」:冷启动永远拿不到 token,线上所有接口都 401。
 */
router.use('/auth', authRoutes);

// 鉴权:Bearer 令牌解析为 res.locals.userId
router.use(attachUser);

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
router.use('/water', waterRoutes);
router.use('/training', trainingRoutes);
// 提醒设置比 /training 更具体,挂在它后面:docs/media 不匹配时会继续往下走
router.use('/training/reminder', reminderRoutes);

export default router;
