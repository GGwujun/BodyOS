-- CreateTable
CREATE TABLE "TrainingDoc" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "clientUpdatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingDoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingDoc_userId_kind_docKey_key" ON "TrainingDoc"("userId", "kind", "docKey");

-- CreateIndex
CREATE INDEX "TrainingDoc_userId_updatedAt_idx" ON "TrainingDoc"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "TrainingDoc" ADD CONSTRAINT "TrainingDoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
