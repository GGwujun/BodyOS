-- 围度记录支持自建部位:内置六个部位各有自己的列,用户自己加的部位(「左上臂」「小腿围」)
-- 没有列,统一住这张键值表(键 = x- 开头的部位键,值 = 厘米)。可空,老数据不受影响。
ALTER TABLE "BodyMeasurement" ADD COLUMN "extras" JSONB;
