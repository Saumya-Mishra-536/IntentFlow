import { PrismaClient } from '@prisma/client';

// OOP: Encapsulation — DB access hidden behind Prisma client
const prisma = new PrismaClient();

// SRP: Only transforms input string → slug
// OOP: Abstraction — hides formatting rules
const slugify = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return cleaned.length ? cleaned : 'account';
};

// SRP: Only generates randomness (utility function)
const random_suffix = () => Math.random().toString(36).slice(2, 8);

// SRP (partial): Generates unique slug
// ⚠️ Slight SRP leak: also depends on DB (mixes logic + persistence concern)
const ensure_unique_slug = async (base_seed: string): Promise<string> => {
  const base = slugify(base_seed); // good reuse (composition)
  let candidate = base;

  for (let i = 0; i < 10; i += 1) {
    // OOP: Encapsulation via Prisma (DB details hidden)
    const exists = await prisma.tenant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });

    if (!exists) return candidate;

    candidate = `${base}-${random_suffix()}`;
  }

  // fallback strategy (still SRP: uniqueness concern)
  return `${base}-${Date.now().toString(36).slice(-4)}`;
};

// ❌ SRP VIOLATION (major)
// This function is doing 3 unrelated responsibilities:
// 1. Tenant slug migration
// 2. Role normalization
// 3. User active tenant assignment
async function run() {

  // Responsibility 1: Fetch tenants
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true },
  });

  // Responsibility 1 continued: Assign slugs
  for (const tenant of tenants) {
    if (!tenant.name.trim()) continue;

    const current = await prisma.tenant.findUnique({
      where: { id: tenant.id },
      select: { slug: true },
    });

    if (current?.slug) continue;

    const slug = await ensure_unique_slug(tenant.name);

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { slug },
    });
  }

  // Responsibility 2: Normalize roles
  await prisma.tenantMember.updateMany({
    where: {
      role: {
        notIn: ['owner', 'admin', 'member'],
      },
    },
    data: { role: 'owner' },
  });

  // Responsibility 3: Fix active tenant for users
  const users = await prisma.user.findMany({
    select: { id: true, active_tenant_id: true },
  });

  for (const user of users) {
    if (user.active_tenant_id) continue;

    const membership = await prisma.tenantMember.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: 'asc' },
      select: { tenant_id: true },
    });

    if (!membership) continue;

    await prisma.user.update({
      where: { id: user.id },
      data: { active_tenant_id: membership.tenant_id },
    });
  }
}

// OOP: Encapsulation of lifecycle (execution + cleanup)
// SRP: Handles program execution + error handling only
run()
  .then(async () => {
    await prisma.$disconnect(); // resource management
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error); // error handling concern
    await prisma.$disconnect();
    process.exit(1);
  });
