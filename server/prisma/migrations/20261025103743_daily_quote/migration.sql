-- CreateTable
CREATE TABLE "DailyQuote" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "sub" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyQuote_pkey" PRIMARY KEY ("id")
);
