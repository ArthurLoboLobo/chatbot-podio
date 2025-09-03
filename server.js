// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

// Importações
const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicialização
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "podio-ajudante-token";

// Credenciais (carregadas do arquivo .env)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// Inicializa o cliente do Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- FUNÇÕES PRINCIPAIS DO BOT ---

// Função para chamar a IA e obter uma dica
async function getAIGeneratedHint(studentCode) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const prompt = `
      Você é um mentor de programação para a Olimpíada Brasileira de Informática (OBI).
      Seu nome é Pódio Ajudante. Seu objetivo é ajudar um aluno a encontrar um erro em seu código C++, mas sem dar a resposta diretamente.

      Analise o código do aluno abaixo.
      Se encontrar um erro, explique o problema de forma conceitual e sugira um caso de teste que faria o código falhar.
      NÃO forneça o código corrigido. Seja breve, amigável e direto ao ponto, como se estivesse falando com um jovem de 15 anos.

      Código do aluno:
      \`\`\`cpp
      ${studentCode}
      \`\`\`
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error("Erro na API do Gemini:", error);
    return "Desculpe, não consegui analisar o código agora. Tente novamente em alguns instantes.";
  }
}

// Função para enviar uma mensagem via API do WhatsApp
async function sendWhatsAppMessage(recipientNumber, messageText) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const headers = {
    'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to: recipientNumber,
    text: { body: messageText }
  });

  try {
    const response = await fetch(url, { method: 'POST', headers: headers, body: body });
    const data = await response.json();
    console.log("Mensagem enviada com sucesso:", data);
  } catch (error) {
    console.error("Erro ao enviar mensagem pelo WhatsApp:", error);
  }
}


// --- ROTAS DO SERVIDOR ---

// Rota principal
app.get('/', (req, res) => {
  res.send('Servidor do Chatbot Pódio no ar!');
});

// Rota de verificação do Webhook
app.get('/whatsapp-webhook', (req, res) => {
  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    console.log("Falha na verificação do Webhook.");
    res.sendStatus(403);
  }
});

// Rota para receber mensagens do WhatsApp
app.post('/whatsapp-webhook', async (req, res) => {
  console.log("Recebemos uma notificação do webhook!");
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const messageInfo = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    
    if (messageInfo) {
      const studentMessage = messageInfo.text?.body;
      const studentNumber = messageInfo.from;

      console.log(`Mensagem de ${studentNumber}: "${studentMessage}"`);
      
      // 1. Pensa em uma resposta com a IA
      const aiResponse = await getAIGeneratedHint(studentMessage);
      console.log(`Resposta da IA: "${aiResponse}"`);

      // 2. Envia a resposta de volta para o aluno
      await sendWhatsAppMessage(studentNumber, aiResponse);
    }
  } catch (error) {
    console.error("Erro ao processar o webhook:", error);
  }

  res.sendStatus(200); // Responde 200 OK para a Meta, confirmando o recebimento
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

// Testando