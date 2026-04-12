# DocVault

DocVault é uma web app para guardar e organizar documentos com cofres partilhados, login por email e Google, categorias personalizadas e suporte para Unraid.

## O que inclui

- Login com email e password
- Login com Google
- Cofres pessoais e partilhados
- Convites por email
- Categorias com ícones personalizados
- Modo demo local
- Interface web responsiva
- Armazenamento persistente em SQLite e disco local

## Estrutura

- `src/` - backend Express e lógica da app
- `public/` - frontend HTML/CSS/JS
- `data/` - base de dados e ficheiros persistentes

## Requisitos

- Node.js 20 ou superior
- npm

## Configuração local

1. Instala dependências:

```bash
npm install
```

2. Cria o ficheiro `.env` a partir de `.env.example`.

3. Arranca em modo desenvolvimento:

```bash
npm run dev
```

4. Abre a app:

```text
http://localhost:3015
```

## Modo demo

Para testar a interface sem login real:

```text
http://localhost:3015/?demo=1
```

## Docker

Build e execução local:

```bash
docker compose up --build
```

## Imagem oficial para Unraid

O repositório publica uma imagem no GitHub Container Registry através do workflow em `.github/workflows/docker-publish.yml`.

Imagem a usar no Unraid:

```text
ghcr.io/barroso88/docvault:latest
```

Sempre que fizeres push para `main`, a imagem `latest` é atualizada. No Unraid, isso permite-te usar o botão de update do próprio container para puxar a versão nova.

## Android com Capacitor

A app também está preparada para Android com Capacitor.

### Gerar / sincronizar

```bash
npm install
npm run mobile:sync
```

### Abrir no Android Studio

```bash
npm run mobile:open
```

Notas importantes:
- precisas de Java e Android Studio instalados localmente
- o shell Android usa o backend público em `https://docs.barrosoportal.com`
- o login Google pode exigir ajustes adicionais no Android, dependendo do dispositivo e do WebView

## Unraid

1. Faz push deste projeto para o GitHub.
2. Espera pelo workflow publicar a imagem no GHCR.
3. No Unraid, cria um container apontando para:
   - `ghcr.io/barroso88/docvault:latest`
4. Mapeia um volume persistente para `/data`.
   - exemplo: `/mnt/user/appdata/docvault:/data`
5. Define as variáveis de ambiente:
   - `PORT=3015`
   - `HOST=0.0.0.0`
   - `JWT_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `DATA_DIR=/data`
6. Se a imagem estiver privada, adiciona as credenciais do GHCR no Unraid ou torna o package público no GitHub.

Fallback útil:
- se a variável não aparecer na UI do Unraid, cria um ficheiro `.env` em `/mnt/user/appdata/docvault/.env` com as mesmas variáveis.
- o container lê esse ficheiro automaticamente no arranque.

## Variáveis de ambiente

Verifica `.env.example` para a lista completa.

## Notas

- O ficheiro `data/` não deve ser versionado.
- O ficheiro `.env` não deve ser commitado.
- A aplicação está preparada para correr tanto localmente como em Docker/Unraid.
- A aplicação também tem base para Android via Capacitor.
