// minha versao: cria (ou promove) o Super Administrador.
//   ZAPHUB_ADMIN_SENHA='...' [ZAPHUB_ADMIN_NOME='Seu nome'] node scripts/setup-admin.js voce@empresa.com
//   node scripts/setup-admin.js --contar      -> imprime quantos Super Administradores existem
// A senha vem por variavel de ambiente, nunca pela linha de comando (ali ela aparece na lista de processos).
// Se o e-mail ja existe, o usuario so e promovido a Super Administrador (a senha nao muda).
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function main() {
    if (process.argv[2] === "--contar") {
        console.log(await prisma.user.count({ where: { role: "SUPERADMIN" } }));
        return;
    }

    const email = (process.argv[2] || "").trim();
    let password = process.env.ZAPHUB_ADMIN_SENHA || "";
    if (!password && process.argv[3]) {
        console.warn("Aviso: senha passada na linha de comando fica visivel na lista de processos. Prefira ZAPHUB_ADMIN_SENHA.");
        password = process.argv[3];
    }
    const nome = (process.env.ZAPHUB_ADMIN_NOME || "").trim() || "Administrador";

    if (!EMAIL_OK.test(email)) {
        console.error("Informe um e-mail valido. Uso: ZAPHUB_ADMIN_SENHA='...' node scripts/setup-admin.js voce@empresa.com");
        process.exit(1);
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
        console.log(`O usuario ${email} ja existe. Promovendo a Super Administrador (a senha nao muda)...`);
        await prisma.user.update({ where: { email }, data: { role: "SUPERADMIN" } });
        console.log("Pronto.");
        return;
    }

    if (password.length < 8) {
        console.error("A senha do Super Administrador precisa ter pelo menos 8 caracteres (em ZAPHUB_ADMIN_SENHA).");
        process.exit(1);
    }

    console.log(`Criando o Super Administrador ${email}...`);
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
        data: { email, name: nome, password: hashedPassword, role: "SUPERADMIN" },
    });
    console.log("Super Administrador criado.");
}

main()
    .catch((e) => {
        console.error(e?.message || e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
