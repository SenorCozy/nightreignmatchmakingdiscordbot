require("dotenv").config(); // ← Load .env vars
const db = require("../database");

const roles = [
  {
    role_id: process.env.SHOP_ROLE_DUCHESS,
    name: "Duchess",
    description: "An elegant title for the elite.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_EXECUTOR,
    name: "Executor",
    description: "Bring swift justice.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_GUARDIAN,
    name: "Guardian",
    description: "Protector of the realm.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_IRONEYE,
    name: "Ironeye",
    description: "Unblinking. Unyielding.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_RAIDER,
    name: "Raider",
    description: "Hulk Smash.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_RECLUSE,
    name: "Recluse",
    description: "Wizard Lady.",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_REVENANT,
    name: "Revenant",
    description: "Summoner",
    price: 100,
  },
  {
    role_id: process.env.SHOP_ROLE_WYLDER,
    name: "Wylder",
    description: "Get Over Here.",
    price: 100,
  },
];

for (const role of roles) {
  if (!role.role_id) continue;

  db.run(
    `INSERT INTO shop_roles (role_id, name, description, price)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(role_id) DO UPDATE SET 
       name = excluded.name,
       description = excluded.description,
       price = excluded.price`,
    [role.role_id, role.name, role.description, role.price],
    (err) => {
      if (err) {
        console.error("❌ Failed to upsert shop role:", role.name, err);
      } else {
        console.log(`✅ Upserted: ${role.name}`);
      }
    }
  );
}
