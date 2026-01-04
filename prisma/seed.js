require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const pool = new Pool({ connectionString: url });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function cfg(value) {
  return JSON.stringify({ value });
}

async function main() {
  const store = await prisma.store.upsert({
    where: { id: "store_default" },
    update: {},
    create: {
      id: "store_default",
      name: "測試門市",
      timezone: "Asia/Taipei",
    },
  });

  await prisma.binding.deleteMany({ where: { storeId: store.id } });
  await prisma.rookieBooking.deleteMany({ where: { storeId: store.id } });
  await prisma.designerDemandOverride.deleteMany({ where: { storeId: store.id } });
  await prisma.leaveRequest.deleteMany({ where: { storeId: store.id } });
  await prisma.approval.deleteMany({ where: { storeId: store.id } });

  const configs = [
    ["safety_factor", 1.1],
    ["assistant_supply", 1.0],
    ["rookie_support_supply", 0.7],
    ["rookie_guest_supply", 0],
    ["designer_default_demand", 0.3],
    ["phase1_start_day", 1],
    ["phase1_end_day", 5],
    ["phase2_start_day", 6],
    ["assistant_block_saturday", true],
    ["assistant_block_if_master_working", true],
    ["binding_mirror_leave", "auto_create"],
    ["rookie_any_booking_supply_zero", true],
  ];

  for (const [key, value] of configs) {
    const existing = await prisma.config.findFirst({
      where: { storeId: store.id, key, effectiveFrom: null },
      select: { id: true },
    });

    if (existing) {
      await prisma.config.update({
        where: { id: existing.id },
        data: { valueJson: cfg(value) },
      });
    } else {
      await prisma.config.create({
        data: { storeId: store.id, key, valueJson: cfg(value), effectiveFrom: null, effectiveTo: null },
      });
    }
  }

  await prisma.user.deleteMany({ where: { storeId: store.id } });

  const manager = await prisma.user.create({
    data: { storeId: store.id, role: "MANAGER", displayName: "店經理", active: true },
  });

  const designerNames = ["ray", "joel", "eva", "chloe", "yena", "joyce", "tobey", "fenny"];

  const designers = [];
  for (const name of designerNames) {
    const d = await prisma.user.create({
      data: {
        storeId: store.id,
        role: "DESIGNER",
        displayName: name,
        active: true,
      },
    });
    designers.push(d);
  }

  const assistant = await prisma.user.create({
    data: {
      storeId: store.id,
      role: "ASSISTANT",
      displayName: "阿嵩",
      active: true,
      baseSupply: 1,
    },
  });

  const rookieNames = ["官官", "rj", "小恩"];
  const rookies = [];
  for (const name of rookieNames) {
    const r = await prisma.user.create({
      data: {
        storeId: store.id,
        role: "ROOKIE",
        displayName: name,
        active: true,
        baseSupply: 0.7,
      },
    });
    rookies.push(r);
  }

  if (designers[0]) {
    await prisma.binding.create({
      data: {
        storeId: store.id,
        assistantId: assistant.id,
        designerId: designers[0].id,
        active: true,
      },
    });
  }

  console.log({
    storeId: store.id,
    managers: [manager.displayName],
    designers: designers.map((d) => d.displayName),
    assistants: [assistant.displayName],
    rookies: rookies.map((r) => r.displayName),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
