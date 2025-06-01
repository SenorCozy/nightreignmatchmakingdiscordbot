require("dotenv").config(); // ← this loads .env vars!
const db = require("../database");

const roles = [
  {
    role_id: process.env.SHOP_ROLE_DUCHESS,
    name: "Duchess",
    description: "An elegant title for the elite.",
    price: 20,
  },
  {
    role_id: process.env.SHOP_ROLE_EXECUTOR,
    name: "Executor",
    description: "Bring swift justice.",
    price: 15,
  },
  {
    role_id: process.env.SHOP_ROLE_GUARDIAN,
    name: "Guardian",
    description: "Protector of the realm.",
    price: 12,
  },
  {
    role_id: process.env.SHOP_ROLE_IRONEYE,
    name: "Ironeye",
    description: "Unblinking. Unyielding.",
    price: 18,
  },
];

for (const role of roles) {
  if (!role.role_id) continue;

  db.run(
    `INSERT OR IGNORE INTO shop_roles (role_id, name, description, price) VALUES (?, ?, ?, ?)`,
    [role.role_id, role.name, role.description, role.price],
    (err) => {
      if (err) {
        console.error("❌ Failed to insert shop role:", role.name, err);
      } else {
        console.log(`✅ Inserted: ${role.name}`);
      }
    }
  );
}
