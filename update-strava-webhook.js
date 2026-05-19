const fs = require('fs');
const path = require('path');

const CLIENT_ID = '203901';
const CLIENT_SECRET = 'f95bd4f6b226b534137a2ac283cf7b1f26c27b1f';

// Nova URL do servidor (Render) apontando para o roteador do webhook
const BASE_URL = 'https://coach-pro-4sys.onrender.com';
const CALLBACK_URL = `${BASE_URL}/api/webhook/strava`;

// Tenta ler o STRAVA_VERIFY_TOKEN do ficheiro .env caso exista
let tokenFromEnv = 'STRAVA_COACH_PRO_TOKEN';
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = envFile.match(/^STRAVA_VERIFY_TOKEN=(.*)$/m);
  if (match && match[1]) {
    // Limpa aspas e quebras de linha que possam vir do .env
    tokenFromEnv = match[1].replace(/['"\r]/g, '').trim();
  }
} catch (e) {
  // Ficheiro .env não encontrado, usamos o padrão
}

// Utilizamos o fallback definido no seu stravaWebhook.ts
const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || tokenFromEnv;

async function migrateStravaWebhook() {
  try {
    console.log(`0. Acordando o servidor Render: ${BASE_URL} ...`);
    await fetch(`${BASE_URL}/api/health`).catch(() => {});
    await new Promise(r => setTimeout(r, 2000)); // Espera o servidor despertar

    console.log('1. Buscando subscrições ativas...');
    const getUrl = `https://www.strava.com/api/v3/push_subscriptions?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
    
    const getRes = await fetch(getUrl);
    const subscriptions = await getRes.json();

    console.log(`-> Encontrada(s) ${subscriptions.length} subscrição(ões).`);

    // 2. Apagar subscrições antigas
    for (const sub of subscriptions) {
      console.log(`2. Apagando subscrição antiga (ID: ${sub.id})...`);
      const deleteUrl = `https://www.strava.com/api/v3/push_subscriptions/${sub.id}?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
      await fetch(deleteUrl, { method: 'DELETE' });
      console.log(`-> Subscrição ${sub.id} apagada com sucesso.`);
    }

    console.log('3. Criando nova subscrição apontando para o Render...');
    
    const formData = new URLSearchParams();
    formData.append('client_id', CLIENT_ID);
    formData.append('client_secret', CLIENT_SECRET);
    formData.append('callback_url', CALLBACK_URL);
    formData.append('verify_token', VERIFY_TOKEN);

    const postRes = await fetch('https://www.strava.com/api/v3/push_subscriptions', {
      method: 'POST',
      body: formData
    });

    const newSub = await postRes.json();
    
    if (newSub.id) {
      console.log('✅ Sucesso! O Webhook foi migrado com ID:', newSub.id);
    } else {
      console.error('❌ Erro ao criar subscrição:', newSub);
    }
  } catch (error) {
    console.error('Erro de execução:', error);
  }
}

migrateStravaWebhook();