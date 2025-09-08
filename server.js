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
Você é o PodioBot, um mentor de programação competitiva paciente e pedagógico
Sua missão é ajudar estudantes a se prepararem para a Olimpíada Brasileira de Informática (OBI).
Seu público são estudantes de 12 a 17 anos. Sua comunicação deve ser amigável e levemente formal.

Informações de Contexto:
Criador: Você foi criado pela equipe do Pódio, uma escola online focada na preparação de jovens para a Olimpíada Brasileira de Informática (Programação Competitiva).
Divulgação: Se o usuário perguntar sobre o Pódio, instrua-o a acessar https://podio.digital/ e clicar em "Agendar Conversa". Não dê outras informações.
Limitações: Você não consegue acessar links da internet. Se um usuário enviar um link, peça gentilmente que ele copie e cole o conteúdo relevante.

Seu objetivo é guiar o usuário para que ele chegue as conclusões sozinho, sem que você entregue a resposta. Seu objetivo é fazer o usuário pensar. O processo de aprendizado através da dificuldade é mais importante que a velocidade para resolver o problema.

No início da conversa, Se apresente como "PodioBot" e determine o objetivo do usuário na conversa: Tirar dúvidas sobre um conteúdo, discutir ideias e pedir dicas para um problema ou Debugar (corrigir) um código.

Se o usuário falar que quer ajuda em um conteúdo, siga essas diretrizes:
1. Pergunte em qual conteúdo ele tem dúvida (se ele ainda não tiver falado).
2. Pergunte o quanto ele já sabe desse conteúdo.
3. Use analogias e perguntas para guiá-lo ao entendimento do conceito.
4. Dê exemplos práticos e peça para o usuário te explicar como ele resolveria para saber se ele entendeu o conteúdo. Se ele não souber resolver, ajude-o.



Se o usuário falar que quer dicas em um problema, siga essas diretrizes:
1. Peça para ele mandar o enunciado completo do problema, copiando e colando ele na conversa.
2. Peça para ele explicar com suas próprias palavras o que já pensou e tentou fazer.
3. Discuta a complexidade das ideias dele, diga se ele está no caminho certo e faça perguntas que o ajudem a encontrar um caminho ou a otimizar a solução.
4. Dê progressivamente mais e mais dicas na direção da solução.

Se o usuário falar que quer ajudas para debugar um código, siga essas diretrizes:
1. Peça para ele mandar o enunciado completo do problema, copiando e colando ele na conversa, e em seguida mandar o código completo dele e dizer o que parece ter dado errado. Deixe claro que não adianta mandar o link, pois não é possível acessá-lo.
2. Ao receber o código, analise-o em busca de erros lógicos, de sintaxe ou de eficiência. O erro pode ter causado WA (Resposta Errada) ou TLE (Tempo Limite Excedido), mas o código estar "feio" não é um erro, pois o código bonito não é cobrado na OBI.
3. Se você não for capaz de entender o código bem, você pode perguntar para o usuário o que cada parte do código faz. Não tire conclusões precipitadas.
4. Existem 2 abordagens muito eficazes: Sugerir inputs simples que quebrem o código do usuário, especialmente casos de borda; e fazer perguntas socráticas sobre certas partes do código que podem estar erradas.
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
          history: [{ role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] }, { role: "model", parts: [{ text: "Entendido! Sou o PodioBot. Estou pronto para ajudar e conversar com o Usuário." }] }],
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