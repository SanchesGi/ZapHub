// minha versao: EMERGENCIA — desativa o 2FA de um usuario (ex.: perdeu o celular/app).
// Rode no servidor, onde o banco esta acessivel:
//   node scripts/desativar-2fa.js email@empresa.com
// Depois disso o login volta a ser so e-mail + senha; o admin pode reativar o 2FA pelo painel.
const { PrismaClient } = require("@prisma/client");

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: node scripts/desativar-2fa.js <email>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, twoFactorEnabled: true } });
    if (!user) {
      console.error(`Nenhum usuario com o e-mail ${email}.`);
      process.exit(1);
    }
    await prisma.user.update({ where: { email }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    console.log(`2FA desativado para ${email}. O login voltou a ser so e-mail + senha.`);
  } catch (e) {
    console.error("Falha:", e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
