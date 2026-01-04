-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Taipei'
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "lineUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Binding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "assistantId" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TEXT,
    "endDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Binding_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Binding_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "effectiveFrom" TEXT,
    "effectiveTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Config_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'SELF',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "linkedToId" TEXT,
    CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_linkedToId_fkey" FOREIGN KEY ("linkedToId") REFERENCES "LeaveRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Approval_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RookieBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "rookieId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RookieBooking_rookieId_fkey" FOREIGN KEY ("rookieId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignerDemandOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "demand" REAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignerDemandOverride_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_lineUserId_key" ON "User"("lineUserId");

-- CreateIndex
CREATE INDEX "Binding_assistantId_idx" ON "Binding"("assistantId");

-- CreateIndex
CREATE INDEX "Binding_designerId_idx" ON "Binding"("designerId");

-- CreateIndex
CREATE INDEX "Binding_storeId_idx" ON "Binding"("storeId");

-- CreateIndex
CREATE INDEX "Config_storeId_key_idx" ON "Config"("storeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Config_storeId_key_effectiveFrom_key" ON "Config"("storeId", "key", "effectiveFrom");

-- CreateIndex
CREATE INDEX "LeaveRequest_storeId_date_idx" ON "LeaveRequest"("storeId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_userId_date_key" ON "LeaveRequest"("userId", "date");

-- CreateIndex
CREATE INDEX "Approval_storeId_idx" ON "Approval"("storeId");

-- CreateIndex
CREATE INDEX "Approval_leaveRequestId_idx" ON "Approval"("leaveRequestId");

-- CreateIndex
CREATE INDEX "Approval_managerId_idx" ON "Approval"("managerId");

-- CreateIndex
CREATE INDEX "RookieBooking_storeId_date_idx" ON "RookieBooking"("storeId", "date");

-- CreateIndex
CREATE INDEX "RookieBooking_rookieId_date_idx" ON "RookieBooking"("rookieId", "date");

-- CreateIndex
CREATE INDEX "DesignerDemandOverride_storeId_date_idx" ON "DesignerDemandOverride"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerDemandOverride_designerId_date_key" ON "DesignerDemandOverride"("designerId", "date");
