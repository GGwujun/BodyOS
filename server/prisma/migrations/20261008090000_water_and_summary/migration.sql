-- AlterTable
ALTER TABLE "DailySummary" ADD COLUMN     "waterMl" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "waterGoalMl" INTEGER NOT NULL DEFAULT 1500;

-- CreateTable
CREATE TABLE "WaterLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountMl" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaterLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaterLog_userId_date_key" ON "WaterLog"("userId", "date");

-- AddForeignKey
ALTER TABLE "WaterLog" ADD CONSTRAINT "WaterLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

