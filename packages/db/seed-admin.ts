import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });
config({ path: path.resolve(__dirname, "../../apps/server/.env") });

const { prisma } = await import("./src");

const ADMIN_EMAIL = "firefallchallenger@gmail.com";

async function main() {
  console.log(`Seeding admin: ${ADMIN_EMAIL}`);

  const authorizedUser = await prisma.authorizedUser.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN" },
    create: {
      email: ADMIN_EMAIL,
      role: "ADMIN",
    },
  });

  console.log(`Authorized ${authorizedUser.email} as ${authorizedUser.role}`);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
