-- CreateTable
CREATE TABLE "CustomFood" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" TEXT NOT NULL DEFAULT '',
    "calories" DOUBLE PRECISION NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fatG" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFood_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFood_userId_createdAt_idx" ON "CustomFood"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFood_userId_name_amount_key" ON "CustomFood"("userId", "name", "amount");

-- AddForeignKey
ALTER TABLE "CustomFood" ADD CONSTRAINT "CustomFood_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
