-- CreateTable
CREATE TABLE "TrainingReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "time" TEXT NOT NULL DEFAULT '20:00',
    "tone" TEXT NOT NULL DEFAULT 'gentle',
    "nudge" BOOLEAN NOT NULL DEFAULT true,
    "tzOffsetMin" INTEGER NOT NULL DEFAULT 480,
    "grants" INTEGER NOT NULL DEFAULT 0,
    "lastSentOn" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingReminder_userId_key" ON "TrainingReminder"("userId");

-- CreateIndex
CREATE INDEX "TrainingReminder_enabled_idx" ON "TrainingReminder"("enabled");

-- AddForeignKey
ALTER TABLE "TrainingReminder" ADD CONSTRAINT "TrainingReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
