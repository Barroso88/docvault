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

## Unraid

1. Faz push deste projeto para o GitHub.
2. No Unraid, aponta o container para esse repositório.
3. Mapeia um volume persistente para `/data`.
4. Define as variáveis de ambiente:
   - `PORT=3015`
   - `HOST=0.0.0.0`
   - `JWT_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `DATA_DIR=/data`

## Variáveis de ambiente

Verifica `.env.example` para a lista completa.

## Notas

- O ficheiro `data/` não deve ser versionado.
- O ficheiro `.env` não deve ser commitado.
- A aplicação está preparada para correr tanto localmente como em Docker/Unraid.
