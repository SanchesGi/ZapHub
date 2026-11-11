# Pasta deploy

Scripts para instalar e manter o ZapHub num servidor Linux. **O guia completo está em [docs/INSTALACAO.md](../docs/INSTALACAO.md).**

## Scripts

| Script | Para quê |
| :--- | :--- |
| `instalar.sh` | Instala tudo (dependências, `.env`, banco, certificado, build, serviço). Rode como usuário comum, sem `sudo`. |
| `configurar-mariadb.sh` | Cria o banco e o usuário no MariaDB/MySQL (`sudo`). |
| `gerar-certificado.sh` | Gera ou renova o certificado HTTPS com os IPs da máquina. |
| `preparar-vm.sh` | Prepara a manutenção pelo painel e a pasta `/var/lib/zaphub/midia` (`sudo`, uma vez). |
| `atualizar.sh` | Atualiza a partir do GitHub, com build seguro e volta automática se falhar. |
| `ativar-atualizacao-automatica.sh` | Liga ou desliga (`desligar`) a atualização a cada 5 minutos (`sudo`). |
| `reconstruir.sh` | Recompila do zero (tela sem estilo, mudança em `NEXT_PUBLIC_*`). |
| `configurar-git-vm.sh` | Deploy key para baixar de um repositório privado (ajuste `REPO_SSH` antes). |
| `regras-sudo.sh` | Usado pelos scripts acima para gravar `/etc/sudoers.d/zaphub`. |

## Dia a dia no servidor

```bash
sudo systemctl status zaphub       # está no ar?
sudo systemctl restart zaphub      # reiniciar
journalctl -u zaphub -f            # log ao vivo
bash deploy/atualizar.sh           # atualizar (ou pelo painel: Manutenção > Sistema)
bash deploy/reconstruir.sh         # recompilar do zero
bash deploy/gerar-certificado.sh   # refazer o certificado (IP mudou) e depois reiniciar
journalctl -u zaphub-atualizar -n 50 --no-pager   # o que aconteceu nas atualizações
```

Acesso: `https://IP_DO_SERVIDOR:3443`. Computadores Windows instalam o certificado por `https://IP_DO_SERVIDOR:3443/instalar-certificado-zaphub.bat`.

O `.env` e a pasta `certificados/` não vão para o git: cada servidor tem os seus. Guarde o `AUTH_SECRET` em lugar seguro.
