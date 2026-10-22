-- CreateTable
CREATE TABLE "WeeklyPushSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "grants" INTEGER NOT NULL DEFAULT 0,
    "lastSentOn" TEXT,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 480,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPushSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPushSetting_userId_key" ON "WeeklyPushSetting"("userId");

-- CreateIndex
CREATE INDEX "WeeklyPushSetting_enabled_idx" ON "WeeklyPushSetting"("enabled");

-- AddForeignKey
ALTER TABLE "WeeklyPushSetting" ADD CONSTRAINT "WeeklyPushSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
