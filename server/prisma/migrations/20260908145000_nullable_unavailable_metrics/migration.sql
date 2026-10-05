-- Unknown estimates are not zero-valued observations.
ALTER TABLE "DailySummary"
  ALTER COLUMN "bodyScore" DROP NOT NULL,
  ALTER COLUMN "bodyScore" DROP DEFAULT,
  ALTER COLUMN "burnCalories" DROP NOT NULL,
  ALTER COLUMN "burnCalories" DROP DEFAULT,
  ALTER COLUMN "netCalories" DROP NOT NULL,
  ALTER COLUMN "netCalories" DROP DEFAULT;
