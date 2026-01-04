/*
  Warnings:

  - The `status` column on the `LeaveRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `source` column on the `LeaveRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `action` on the `Approval` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `role` on the `User` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DESIGNER', 'ASSISTANT', 'ROOKIE', 'MANAGER');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "LeaveRequestSource" AS ENUM ('SELF', 'BINDING_MIRROR', 'MANAGER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT', 'FORCE_APPROVE');

-- AlterTable
ALTER TABLE "Approval" DROP COLUMN "action",
ADD COLUMN     "action" "ApprovalAction" NOT NULL;

-- AlterTable
ALTER TABLE "DesignerDemandOverride" ALTER COLUMN "demand" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "LeaveRequest" DROP COLUMN "status",
ADD COLUMN     "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
DROP COLUMN "source",
ADD COLUMN     "source" "LeaveRequestSource" NOT NULL DEFAULT 'SELF';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL,
ALTER COLUMN "baseDemand" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "baseSupply" SET DATA TYPE DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");
