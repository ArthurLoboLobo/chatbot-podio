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
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

// Armazenamento de conversas em memória (para produção, usar um banco de dados)
let conversations = {};

// A "Persona" do nosso bot. A instrução de sistema.
const SYSTEM_INSTRUCTION = `
Você é o "Pódio Ajudante", um mentor de programação experiente, amigável e pedagógico, especializado em preparar jovens para a Olimpíada Brasileira de Informática (OBI). Seu público são estudantes de 12 a 17 anos. Sua comunicação deve ser encorajadora e direta, como um irmão mais velho que entende do assunto.

Suas regras de operação são:
1.  **Nunca dê a solução direta:** Seu objetivo é guiar o aluno para que ele encontre a solução sozinho. Use perguntas socráticas, sugira casos de teste e aponte para conceitos teóricos.
2.  **Seja conversacional:** O aluno pode não enviar um código. Ele pode descrever um problema, fazer uma pergunta teórica ou pedir para você explicar um trecho de código. Adapte-se ao que ele precisa.
3.  **Análise de Código:** Ao receber um código, analise-o em busca de erros lógicos, de sintaxe ou de eficiência. Explique o problema conceitualmente. Exemplo: "Notei que você está usando um loop dentro do outro aqui. Para o tamanho da entrada desse problema, isso pode exceder o tempo limite. Será que existe uma forma de encontrar o que você busca sem precisar do segundo loop?".
4.  **Sugestão de Casos de Teste:** Uma das suas melhores ferramentas é sugerir inputs que quebrem o código do aluno. Exemplo: "Seu código funciona bem para casos gerais, mas você já testou o que acontece se a lista de números for \`[5, 4, 3, 2, 1]\`? Ou se a lista tiver apenas um elemento?".
5.  **Mantenha o Contexto:** Use o histórico da conversa para entender o problema completo do aluno. Se ele descreveu um problema e depois enviou um código, assuma que o código é uma tentativa de solução para aquele problema.
`;

// --- FUNÇÕES PRINCIPAIS DO BOT ---

// Função para enviar uma mensagem via API do WhatsApp
async function sendWhatsAppMessage(recipientNumber, messageText) {
  const url = `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const headers = { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ messaging_product: "whatsapp", to: recipientNumber, text: { body: messageText } });

  try {
    const response = await fetch(url, { method: 'POST', headers: headers, body: body });
    const data = await response.json();
    if (data.error) {
      console.error("Erro ao enviar mensagem pelo WhatsApp:", data.error);
    } else {
      console.log("Mensagem enviada com sucesso:", data);
    }
  } catch (error) {
    console.error("Erro na chamada para a API do WhatsApp:", error);
  }
}


// --- ROTAS DO SERVIDOR ---

// Rota principal
app.get('/', (req, res) => res.send('Servidor do Chatbot Pódio no ar!'));

// Rota de verificação do Webhook
app.get('/whatsapp-webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
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
  
  try {
    const messageInfo = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (messageInfo) {
      const studentMessage = messageInfo.text?.body;
      const studentNumber = messageInfo.from;

      console.log(`Mensagem de ${studentNumber}: "${studentMessage}"`);

      // Gerencia a conversa e obtém a resposta da IA
      if (!conversations[studentNumber]) {
        conversations[studentNumber] = geminiModel.startChat({
          history: [{ role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] }, { role: "model", parts: [{ text: "Entendido! Sou o Pódio Ajudante. Estou pronto para ajudar. Qual o seu desafio de hoje?" }] }],
          generationConfig: { maxOutputTokens: 1000 },
        });
      }
      const chat = conversations[studentNumber];
      
      // Manda a mensagem para a IA e trata os erros
      let aiResponse;
      try {
        const result = await chat.sendMessage(studentMessage);
        const response = await result.response;
        aiResponse = response.text();
      } catch (error) {
        console.error("Erro na API do Gemini:", error);
        const errorString = String(error);
        if (errorString.includes("503") || errorString.toLowerCase().includes("overloaded")) {
          aiResponse = "O servidor da IA parece estar sobrecarregado no momento. Por favor, espere alguns segundos e envie sua mensagem novamente.";
        } else {
          aiResponse = "Desculpe, ocorreu um erro ao processar sua solicitação. Tente novamente em alguns instantes.";
        }
      }
      
      console.log(`Resposta da IA: "${aiResponse}"`);

      // Envia a resposta de volta para o aluno
      await sendWhatsAppMessage(studentNumber, aiResponse);
    }
  } catch (error) {
    console.error("Erro ao processar o webhook:", error);
  }

  res.sendStatus(200);
});

// Inicia o servidor
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));