# Carteira WEB V4.1

Aplicação PWA offline-first para guardar documentos localmente no navegador com criptografia por documento, backup externo protegido e migração das versões antigas.


## Atualização visual V4.1

A V4.1 mantém a arquitetura e as funções da V4, mas troca completamente a linguagem visual. O objetivo foi evitar a aparência comum de interfaces geradas por IA ou “vibecoding”.

- Removidos gradientes, brilhos, glassmorphism, blobs/orbs decorativos e sombras exageradas.
- Paleta refeita em branco, cinza neutro, grafite e azul funcional discreto.
- Tipografia baseada na fonte nativa do sistema, sem dependências externas.
- Bordas e raios menores, próximos de ferramentas web tradicionais.
- Hero reduzido: a aplicação agora abre como ferramenta, não como landing page promocional.
- Cards e modais mais compactos e funcionais.
- Botões sem gradiente e sem animações de “flutuar”.
- Novo ícone do aplicativo, geométrico e monocromático.
- Cache do service worker atualizado para `v4.1.0` para garantir a troca do CSS antigo.

## O que mudou

- Novo visual responsivo e mais limpo.
- Novo banco IndexedDB (`CarteiraWebDB`) com IDs únicos por documento.
- Criptografia AES-GCM 256 bits com chave derivada por PBKDF2-SHA-256.
- Migração automática da versão antiga em IndexedDB (`DocsDB/docs`).
- Migração da versão antiga em `localStorage` (`imagensCriptografadas`).
- Recriptografia automática de documentos antigos após abertura com a senha correta.
- Solicitação de armazenamento persistente via `navigator.storage.persist()`.
- Indicadores de uso/cota de armazenamento.
- Backup externo protegido por senha em arquivo `.carteira`.
- Restauração de backup com opção de mesclar ou substituir a carteira atual.
- Suporte a imagens e PDFs.
- Busca, ordenação, renomear, excluir, visualizar e baixar arquivo descriptografado.
- Bloqueio automático da visualização quando o app vai para segundo plano.
- PWA/service worker refeito para uso offline.
- CSP básica para reduzir superfícies de ataque.

## Arquivos

- `index.html` — estrutura da interface.
- `styles.css` — design responsivo.
- `app.js` — banco, criptografia, migração, backup e interface.
- `service-worker.js` — cache do app shell e suporte offline.
- `manifest.json` — instalação PWA.
- `icon-192.png` / `icon-512.png` — ícones do aplicativo.
- `RELATORIO_COMPLETO.md` — auditoria do projeto antigo e mudanças realizadas.

## Como publicar no GitHub Pages

1. Faça um backup dos arquivos atuais do repositório.
2. Substitua os arquivos da raiz pelos arquivos desta pasta.
3. Faça commit e push para a branch usada pelo GitHub Pages.
4. Abra a aplicação pelo **mesmo endereço/origem onde a versão atual é usada**.
5. Aguarde a primeira inicialização. A V4 procurará os dados antigos e os copiará para o novo banco.
6. Teste a abertura de pelo menos um documento antigo com a senha correta.
7. Gere imediatamente um backup `.carteira`.

> Importante: os bancos do navegador são vinculados à origem do site. Se você testar em `localhost` ou em outro domínio, a V4 não verá os dados antigos que estão no GitHub Pages.

## Primeira atualização

Na primeira execução no mesmo domínio:

1. A V4 abre o banco novo `CarteiraWebDB`.
2. Procura o banco antigo `DocsDB`, store `docs`.
3. Procura também `localStorage.imagensCriptografadas`.
4. Copia os registros antigos para o banco novo **sem apagar as fontes antigas**.
5. Os documentos entram marcados como “CRIPTOGRAFIA ANTIGA”.
6. Quando o usuário abre um deles corretamente, o conteúdo é recriptografado em AES-GCM.

Também existe o botão **“Verificar versão antiga”** para repetir a busca manualmente.

## Backup e restauração

O botão **Criar backup** gera um arquivo `CarteiraWEB-backup-AAAA-MM-DD.carteira`.

- O backup inteiro é protegido com AES-GCM.
- A senha do backup não é armazenada.
- A senha do backup pode ser diferente das senhas dos documentos.
- Se a senha do backup for perdida, o arquivo não poderá ser restaurado.

Na restauração é possível:

- Mesclar os documentos do backup com os atuais; ou
- Marcar “Substituir a carteira atual” para limpar a V4 antes de importar.

## Armazenamento persistente

A aplicação verifica `navigator.storage.persisted()` e permite solicitar `navigator.storage.persist()`.

Isso reduz o risco de o navegador remover automaticamente os dados em situações de pressão de armazenamento, mas **não substitui backup**. O usuário ainda pode apagar dados do site manualmente, remover o perfil do navegador ou perder o dispositivo.

## Segurança

Documentos novos usam:

- AES-GCM 256 bits;
- PBKDF2;
- SHA-256;
- 250.000 iterações;
- salt aleatório por criptografia;
- IV aleatório por criptografia.

As senhas não são gravadas no banco. O nome do documento e alguns metadados ficam em texto legível no IndexedDB para permitir listagem e busca sem pedir uma senha mestre.

## Requisitos

Navegador moderno com:

- IndexedDB;
- Web Crypto API;
- `<dialog>`;
- Service Worker para modo offline;
- HTTPS para Service Worker e Storage Persistence em produção.

## Limite de arquivo

A interface limita cada documento a 25 MB para evitar operações excessivamente pesadas em memória no navegador.

## Teste rápido recomendado depois do deploy

1. Abrir a V4 no endereço normal do GitHub Pages.
2. Conferir se documentos antigos aparecem.
3. Abrir um documento antigo com senha correta e confirmar que o selo muda para AES-GCM.
4. Adicionar dois documentos com o mesmo nome e confirmar que ambos permanecem.
5. Recarregar a página e conferir se continuam listados.
6. Instalar o PWA e testar modo offline.
7. Criar um backup `.carteira`.
8. Adicionar um documento de teste, restaurar o backup e confirmar a recuperação.
9. Verificar o cartão “Proteção local” e solicitar armazenamento persistente se ainda não estiver ativo.

