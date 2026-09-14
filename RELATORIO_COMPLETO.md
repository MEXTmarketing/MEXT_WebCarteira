# Relatório completo — auditoria e reconstrução da Carteira WEB

## Atualização V4.1 — revisão visual “codado à mão”

Depois da reconstrução funcional da V4, a interface foi revisada novamente para remover características visuais associadas a templates genéricos, interfaces SaaS geradas por IA e “vibecoding”. Nenhuma alteração desta etapa muda o formato dos documentos salvos, o banco IndexedDB ou o mecanismo de criptografia.

### Problemas visuais da primeira V4

- Fundo escuro com iluminação radial e elementos decorativos desfocados.
- Cores neon/azul-violeta e alto contraste que lembravam dashboards genéricos.
- Botões com gradientes e sombras coloridas.
- Cards muito arredondados e uso de transparência/glassmorphism.
- Título principal grande demais para um utilitário, com aparência de landing page.
- Muitos elementos com estética “premium SaaS” em vez de ferramenta pessoal.

### Mudanças aplicadas na V4.1

- Fundo neutro `#f3f4f6` e superfícies brancas.
- Cor funcional principal azul sóbrio `#2459a6`; sem rosa, roxo neon ou degradês.
- Tipografia nativa do sistema operacional para aparência natural e carregamento imediato.
- Raios reduzidos para 5–10 px e bordas cinza convencionais.
- Sombras limitadas a estados em que ajudam na hierarquia, sem glow.
- Cabeçalho compacto com borda inferior, semelhante a aplicações web tradicionais.
- Hero convertido em resumo funcional, com título menor e linguagem menos publicitária.
- Área de documentos organizada como painel de trabalho.
- Cards de documento mais secos, compactos e com ações diretas.
- Modais brancos e objetivos, com campos e botões convencionais.
- Indicadores de status discretos, sem efeitos luminosos.
- Novo ícone do app com desenho simples de carteira em grafite/branco e pequeno detalhe azul.
- `theme_color` e `background_color` do PWA alinhados ao novo visual claro.
- Versão de cache atualizada para `webcarteira-shell-v4.1.0`, evitando que usuários permaneçam vendo o CSS antigo após a publicação.

### O que foi preservado

A camada de dados e segurança continua igual: IndexedDB com IDs únicos, AES-GCM/PBKDF2, migração de versões antigas, backup `.carteira`, restauração, modo offline, persistência, busca e suporte a PDF/imagem.

---


## 1. Resumo executivo

O projeto original tinha uma boa ideia de base: PWA, IndexedDB e funcionamento local/offline. O principal problema não era apenas “cache”. Havia uma combinação de riscos que podia fazer o usuário acreditar que documentos tinham desaparecido, permitir substituições silenciosas e deixar o armazenamento vulnerável à política de descarte do navegador.

A V4 foi reconstruída para atacar esses pontos em três frentes:

1. **Durabilidade:** armazenamento persistente quando o navegador permite, IDs únicos, migração e backup externo.
2. **Segurança:** substituição do XOR simples por AES-GCM + PBKDF2.
3. **Experiência:** interface nova, feedback de erro, busca, ordenação, PDF, backup/restauração e indicadores de saúde do armazenamento.

---

## 2. Problemas encontrados no projeto antigo

### 2.1 Service Worker com erro de variável — CRÍTICO

No `service-worker.js` original era declarado:

```js
const urlsToCache = [ ... ];
```

mas no `install` era utilizado:

```js
cache.addAll(URLS_TO_CACHE)
```

JavaScript diferencia maiúsculas de minúsculas. `URLS_TO_CACHE` não existia. Isso podia fazer a instalação do Service Worker falhar e comprometer o funcionamento offline esperado.

**Correção:** o Service Worker foi refeito, com lista de app shell consistente, versionamento de cache, `skipWaiting()`, `clients.claim()` e fallback para navegação offline.

---

### 2.2 IndexedDB padrão não era persistente — ALTO

O projeto usava IndexedDB, mas nunca verificava nem solicitava armazenamento persistente.

Por padrão, dados de sites podem ficar no modo “best effort”. Em determinadas condições, especialmente pressão de espaço, o navegador pode remover dados locais. Isso é diferente de “limpar o cache” manualmente.

**Correção:** a V4 usa:

```js
navigator.storage.persisted()
navigator.storage.persist()
navigator.storage.estimate()
```

A interface mostra ao usuário se a proteção está ativa e quanto espaço o site está usando.

**Limitação importante:** nenhum mecanismo puramente local no navegador elimina 100% do risco. Por isso a V4 também cria backup externo.

---

### 2.3 Nome do documento usado como chave primária — ALTO

O banco antigo era criado assim:

```js
db.createObjectStore('docs', { keyPath: 'title' });
```

E salvava com:

```js
store.put({ title, data });
```

Como `title` era a chave, salvar outro documento com o mesmo nome fazia `put()` substituir o anterior. Não havia aviso de duplicidade.

Isso podia ser percebido pelo usuário como “um documento sumiu”.

**Correção:** a V4 usa `id` único por documento (`crypto.randomUUID()` quando disponível). O título deixou de ser identificador, portanto podem existir vários itens com o mesmo nome.

---

### 2.4 Criptografia XOR simples — CRÍTICO DE SEGURANÇA

O projeto antigo fazia XOR caractere a caractere usando a própria senha e depois `btoa()`.

XOR repetitivo com chave derivada diretamente da senha não fornece segurança adequada para documentos pessoais. O próprio README antigo alertava que era apenas educacional/protótipo.

**Correção:** documentos novos usam:

- AES-GCM 256 bits;
- PBKDF2;
- SHA-256;
- 250.000 iterações;
- salt aleatório;
- IV aleatório;
- autenticação integrada do AES-GCM, permitindo detectar senha errada/corrupção corretamente.

---

### 2.5 Senha exibida como texto comum — ALTO

Na versão antiga os campos de senha eram criados/definidos com:

```html
<input type="text">
```

Isso expunha a senha visualmente na tela.

**Correção:** todos os campos sensíveis usam `type="password"`, com botão explícito Mostrar/Ocultar.

---

### 2.6 Não havia backup real na versão principal — CRÍTICO DE DURABILIDADE

Se o perfil do navegador fosse apagado, o dispositivo perdido, o site removido dos dados locais ou o navegador descartasse o bucket, não havia uma cópia externa na versão principal.

**Correção:** foi criado backup `.carteira`, contendo todos os documentos da V4 e protegido por uma senha própria usando AES-GCM.

A restauração aceita mesclar ou substituir a carteira atual.

---

### 2.7 Versão antiga de `localStorage` usava `eval()` na importação — CRÍTICO DE SEGURANÇA

O arquivo antigo `index localstorage.html` gerava código JavaScript e depois executava o conteúdo do textarea com:

```js
eval(textarealocal.value)
```

Executar conteúdo importado com `eval()` permite execução arbitrária de JavaScript se o conteúdo for alterado/malicioso.

**Correção:** a V4 não usa `eval()` em nenhuma restauração. Backups são JSON estruturado, validados e descriptografados antes da importação.

O arquivo antigo não foi incluído no novo pacote de produção.

---

### 2.8 Estado global da imagem criptografada não era zerado corretamente — MÉDIO/ALTO

A versão antiga mantinha:

```js
let imagemCriptografada = '';
```

Ao fechar o modal, os inputs eram limpos, mas essa variável não era explicitamente zerada. Em certos fluxos, o estado anterior podia permanecer em memória e ser reutilizado por engano.

**Correção:** na V4 não existe uma etapa manual “Processar” separada do “Salvar”. O arquivo é lido, criptografado e persistido numa única operação assíncrona. O formulário é resetado após concluir/cancelar.

---

### 2.9 Detecção de senha errada dependia do `<img onerror>` — MÉDIO

No legado, uma senha errada gerava bytes incorretos e o código tentava colocar o resultado no `src` da imagem. O erro era inferido quando a imagem falhava ao carregar.

Isso mistura validação criptográfica com comportamento visual do navegador.

**Correção:** AES-GCM autentica o ciphertext. Senha incorreta ou conteúdo alterado causa falha criptográfica (`OperationError`) antes da visualização.

No formato legado, a V4 faz validação explícita do Data URL antes de aceitar o conteúdo.

---

### 2.10 Erros de IndexedDB ficavam principalmente no console — MÉDIO

No código antigo várias falhas usavam somente:

```js
console.error(...)
```

O usuário podia clicar em salvar e, em caso de quota/erro de gravação, não receber orientação adequada.

**Correção:** a V4 trata erros e exibe toasts, incluindo mensagem específica para `QuotaExceededError` e bloqueios de armazenamento.

---

### 2.11 Sem verificação de tamanho e formato — MÉDIO

Não havia limite prático nem validação adequada antes de converter o arquivo inteiro para Data URL/Base64.

**Correção:** a V4 aceita imagens e PDFs e limita a 25 MB por documento. Arquivos novos são criptografados a partir dos bytes (`ArrayBuffer`), evitando armazenar Base64 do arquivo original.

---

### 2.12 Base64 aumentava o tamanho do conteúdo — MÉDIO

A imagem antiga era convertida para Data URL/Base64 antes de criptografar. Base64 adiciona overhead de armazenamento, além do prefixo do Data URL.

**Correção:** documentos novos são criptografados diretamente como bytes e gravados como `ArrayBuffer` no IndexedDB.

---

### 2.13 Cache antigo podia apagar caches não relacionados — MÉDIO

O `activate` antigo percorria todos os nomes de cache da origem e apagava qualquer um que não fosse exatamente o cache atual.

Em hosts que compartilham a mesma origem entre projetos, isso é agressivo.

**Correção:** a V4 só remove caches cujo nome começa com o prefixo próprio:

```js
webcarteira-shell-
```

---

### 2.14 Sem estratégia clara de atualização do PWA — MÉDIO

O Service Worker antigo não usava `skipWaiting()` nem `clients.claim()` e tinha uma estratégia muito básica de cache-first.

**Correção:** app shell versionado, atualização de cache controlada e navegação com network-first/fallback offline.

---

### 2.15 Código monolítico — MANUTENIBILIDADE

HTML, CSS e JavaScript estavam praticamente todos dentro do `index.html`, dificultando revisão, manutenção e cache seletivo.

**Correção:** separação em:

- `index.html`
- `styles.css`
- `app.js`
- `service-worker.js`
- `manifest.json`

---

### 2.16 Marcação/CSS redundante e código morto — BAIXO/MÉDIO

Havia, entre outros pontos:

- fechamento `</style>` duplicado;
- `div#center` sem função na versão principal;
- função `observarLocalStorage()` vazia;
- menu DEV incompleto;
- uso de `<center>` obsoleto;
- bloqueio global de seleção de texto (`user-select: none`).

**Correção:** estrutura semântica nova, CSS organizado e remoção desses trechos.

---

### 2.17 Sem bloqueio da visualização ao ir para segundo plano — PRIVACIDADE

Após abrir um documento, ele podia permanecer visível quando o usuário alternava de aplicativo/aba e voltava.

**Correção:** se a página ficar oculta durante uma visualização descriptografada, a V4 revoga a URL temporária e bloqueia novamente o documento.

---

### 2.18 Sem política de conteúdo — SEGURANÇA/ENDURECIMENTO

Não havia Content Security Policy.

**Correção:** a V4 inclui CSP restritiva para scripts, estilos, workers, imagens e frames locais/blob/data necessários ao app.

---

## 3. Por que os documentos podiam “sumir” mesmo sem limpar cache

Há pelo menos três causas plausíveis no projeto antigo:

### A. Sobrescrita silenciosa por título

Como o título era a chave do IndexedDB, um novo `put()` com o mesmo título substituía o registro antigo.

### B. Armazenamento “best effort” do navegador

IndexedDB não é automaticamente “eterno”. Sem persistência concedida, o navegador pode remover dados de uma origem em situações de pressão de armazenamento ou conforme suas políticas.

### C. Mudança de origem/perfil/contexto

IndexedDB e `localStorage` pertencem à origem do site e ao perfil do navegador. Abrir uma cópia em outro domínio, `localhost`, outro perfil, modo privado ou outro navegador apresenta um armazenamento diferente, mesmo que os arquivos do site sejam idênticos.

Por isso a solução correta não é trocar IndexedDB por `localStorage`. Para documentos, IndexedDB continua sendo uma escolha melhor; o importante é adicionar persistência, arquitetura correta e uma saída de backup.

---

## 4. Arquitetura nova

### Banco principal

- Banco: `CarteiraWebDB`
- Store: `documents`
- Chave: `id`
- Índices: `title`, `updatedAt`
- Store de metadados: `meta`

Cada documento possui, entre outros:

```text
id
title
type
size
originalName
createdAt
updatedAt
legacy
encryption
```

---

## 5. Migração dos dados antigos

A V4 procura automaticamente:

### IndexedDB V3

- Banco: `DocsDB`
- Store: `docs`
- Formato: `{ title, data }`

### localStorage antigo

- Chave: `imagensCriptografadas`
- Formato: array JSON de `{ title, data }`

Os registros são copiados para o banco novo e a origem antiga **não é apagada**.

Foi incluída uma fingerprint de migração para evitar duplicar o mesmo registro quando o usuário executa “Verificar versão antiga” novamente.

### Atualização de criptografia

Como a V4 não conhece a senha antiga do documento, ela não pode recriptografar tudo durante a migração.

Fluxo correto:

1. Item antigo é importado ainda como XOR legado.
2. Usuário abre o documento e informa a senha correta.
3. V4 descriptografa o legado.
4. V4 criptografa novamente com AES-GCM usando a mesma senha.
5. O registro do banco novo é atualizado para V2.
6. O banco antigo continua intacto como segurança durante a transição.

---

## 6. Backup novo

O arquivo `.carteira` não é apenas um dump aberto dos dados.

Fluxo:

1. Documentos são serializados.
2. `ArrayBuffer`s criptografados são convertidos para Base64 apenas para transporte dentro do JSON.
3. Todo o snapshot, incluindo títulos e metadados, é criptografado novamente com a senha do backup.
4. O wrapper final contém apenas dados necessários para derivar a chave e o ciphertext.

A senha do backup não é salva.

---

## 7. Melhorias de interface

A interface foi refeita com foco em mobile/PWA e uso rápido:

- dashboard de armazenamento;
- contador de documentos;
- status de persistência;
- espaço utilizado e quota estimada;
- data do último backup;
- cards de documentos;
- busca instantânea;
- ordenação por nome/data;
- renomear documento;
- excluir documento;
- visualização em modal;
- PDFs embutidos;
- imagens responsivas;
- download do arquivo descriptografado;
- drag and drop no desktop;
- botão de instalação PWA quando o navegador disponibiliza o evento;
- indicador Online/Offline;
- toasts no lugar de depender de `alert()` para tudo;
- layout responsivo para celular.

---

## 8. Melhorias do PWA/offline

### Antes

- instalação do SW podia falhar por `URLS_TO_CACHE` inexistente;
- estratégia cache-first extremamente simples;
- limpeza agressiva de todos os caches da origem;
- sem `skipWaiting()`/`clients.claim()`.

### Agora

- cache versionado `webcarteira-shell-v4.1.0`;
- somente arquivos do app shell entram na instalação;
- navegação tenta rede e cai para `index.html` em cache;
- assets usam cache com preenchimento após fetch;
- caches de versões antigas são removidos apenas se tiverem prefixo da Carteira WEB;
- atualização assume controle mais rápido.

---

## 9. Mudanças de segurança

### Implementadas

- AES-GCM 256 bits;
- PBKDF2-SHA-256 com 250.000 iterações;
- salt e IV aleatórios;
- senhas com campos ocultos;
- ausência de `eval()`;
- CSP;
- bloqueio da visualização ao ocultar a aba/app;
- URLs de Blob revogadas após uso;
- validação de formato/tamanho;
- senha não salva;
- backup inteiro protegido por senha.

### Ainda propositalmente não criptografado no banco local

O **título do documento e metadados** ficam legíveis no IndexedDB para permitir busca/listagem sem pedir uma senha mestre.

Para esconder também os títulos, seria necessário introduzir uma senha mestre ou mecanismo semelhante.

---

## 10. Mudanças de funcionalidade

| Recurso | Antigo | V4 |
|---|---|---|
| Armazenamento | IndexedDB por título | IndexedDB por ID único |
| Criptografia | XOR | AES-GCM + PBKDF2 |
| Mesmo nome | Sobrescrevia | Permitido |
| Backup | Não na versão principal | `.carteira` protegido |
| Restaurar | Não | Sim |
| Migração IndexedDB | Não | Sim |
| Migração localStorage | Não | Sim |
| Persistência de storage | Não | Solicita/verifica |
| Estimativa de quota | Não | Sim |
| Imagens | Sim | Sim |
| PDF | Não | Sim |
| Renomear | Não | Sim |
| Ordenar | Apenas lógica básica | UI com 4 opções |
| Offline | SW com bug | SW refeito |
| PWA install UI | Não | Sim quando suportado |
| Senha oculta | Não | Sim |
| Bloqueio ao sair da aba | Não | Sim |
| Feedback de quota | Não | Sim |

---

## 11. Arquivos entregues

```text
webCarteira-refeito/
├── index.html
├── styles.css
├── app.js
├── service-worker.js
├── manifest.json
├── icon-192.png
├── icon-512.png
├── README.md
└── RELATORIO_COMPLETO.md
```

O arquivo inseguro/legado `index localstorage.html` não foi incluído na versão nova.

---

## 12. Validações executadas nesta entrega

Foram feitas as seguintes validações estáticas:

- `node --check app.js` — sintaxe JavaScript válida;
- `node --check service-worker.js` — sintaxe JavaScript válida;
- `manifest.json` validado como JSON;
- verificação automática de IDs usados por `app.js` contra os IDs existentes no `index.html`;
- verificação de IDs HTML duplicados;
- inspeção visual do ícone 512×512.

Foi preparada uma tentativa de teste end-to-end com Chromium/Playwright, mas o ambiente desta sessão bloqueia navegação local (`ERR_BLOCKED_BY_ADMINISTRATOR`). Por isso não estou marcando como “testado em navegador real” algo que o ambiente não permitiu executar.

**Recomendação:** depois de publicar no GitHub Pages, executar o checklist da seção 14 abaixo antes de considerar a migração concluída.

---

## 13. Cuidados no deploy

### Publique no mesmo endereço

Para a migração automática encontrar `DocsDB`/`localStorage` antigos, a V4 precisa ser aberta na mesma origem do navegador onde os documentos atuais estão salvos.

Exemplo:

```text
https://bresodev.github.io/webCarteira/
```

Testar primeiro em outro domínio é ótimo para visual, mas esse ambiente de teste não verá o banco do endereço original.

### Não apague os dados antigos de imediato

A V4 já não apaga o `DocsDB` nem o `localStorage` antigos. Recomendo manter assim durante um período de transição.

Depois que:

- todos os documentos estiverem aparecendo;
- alguns antigos tiverem sido abertos/migrados para AES-GCM;
- um backup `.carteira` tiver sido gerado e testado;

você pode decidir se quer criar uma ferramenta futura para limpar o legado.

---

## 14. Checklist de teste após publicar

1. Abrir a V4 pelo endereço oficial.
2. Confirmar que os documentos antigos aparecem.
3. Usar “Verificar versão antiga” e conferir que não duplica os mesmos registros.
4. Abrir pelo menos 2 documentos antigos com as senhas corretas.
5. Confirmar que o badge deixa de mostrar “CRIPTOGRAFIA ANTIGA”.
6. Adicionar um documento novo.
7. Recarregar a página.
8. Fechar e abrir o navegador.
9. Adicionar dois documentos com exatamente o mesmo título e confirmar que os dois continuam.
10. Testar imagem JPG/PNG.
11. Testar PDF.
12. Renomear um documento.
13. Excluir um documento de teste.
14. Solicitar armazenamento persistente.
15. Criar backup `.carteira`.
16. Guardar a senha do backup.
17. Em uma carteira de teste, restaurar o backup.
18. Instalar o PWA.
19. Abrir o PWA online uma vez.
20. Desligar a internet e confirmar que a interface continua abrindo.

---

## 15. Limitações que continuam existindo

Mesmo com a V4, um app 100% local tem limites:

- se o usuário apagar explicitamente os dados do site, o IndexedDB pode ser removido;
- se o perfil do navegador for excluído, o banco local vai junto;
- perda/formatação do dispositivo elimina a cópia local;
- `persist()` é um pedido ao navegador, não uma ordem absoluta em todos os ambientes;
- sem a senha de um documento não há recuperação do conteúdo;
- sem a senha do backup não há recuperação do arquivo `.carteira`;
- ainda não existe sincronização em nuvem/multi-dispositivo.

A defesa contra os três primeiros pontos é o **backup externo**.

---

## 16. Próximas evoluções possíveis

Se você quiser levar a Carteira WEB para uma V5, as evoluções mais naturais seriam:

- senha mestre opcional para também ocultar títulos/metadados;
- WebAuthn/biometria para desbloqueio local;
- backup/sincronização opcional em nuvem com criptografia ponta a ponta;
- múltiplas páginas por documento;
- captura direta da câmera com recorte e correção de perspectiva;
- categorias/pastas;
- favoritos;
- lembretes de validade de documentos;
- teste automatizado de navegador no GitHub Actions.

---

## 17. Conclusão

O maior salto da V4 não é apenas visual. A arquitetura deixou de tratar IndexedDB como se fosse armazenamento permanente por definição e passou a trabalhar com:

- persistência solicitada;
- IDs únicos;
- criptografia moderna;
- migração compatível;
- backup externo;
- restauração;
- feedback de quota/erro;
- PWA offline corrigido.

Isso reduz bastante tanto o risco de perda percebida quanto os riscos de segurança presentes nas versões antigas.
