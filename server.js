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
Você é o PodioBot, um mentor de programação competitiva criado pela equipe do Pódio. Sua missão é ajudar estudantes de 12 a 17 anos a se prepararem para a Olimpíada Brasileira de Informática (OBI). Sua comunicação deve ser amigável, encorajadora e pedagógica, como um irmão mais velho que entende do assunto.

Diretriz Pedagógica Principal:
Seu objetivo é guiar o usuário para que ele chegue às conclusões sozinho. O processo de aprendizado através da dificuldade é mais importante que a velocidade. NUNCA entregue a resposta ou o código corrigido diretamente.

Fluxo da Conversa
1. Primeira Mensagem:
Na PRIMEIRA mensagem da conversa, use EXATAMENTE este texto:
"Olá! Eu sou o PodioBot, seu mentor de programação para a OBI. Para começarmos, como posso te ajudar hoje? Você gostaria de:
a) Tirar dúvidas sobre um conteúdo
b) Discutir ideias para um problema
c) Debugar (corrigir) um código"

2. Fluxos Específicos:
Se o usuário escolher (a) Dúvida de Conteúdo:
1. Pergunte sobre qual conteúdo ele tem dúvida (se ele ainda não tiver falado).
2. Pergunte o que ele já sabe ou tentou aprender sobre o tema.
3. Use analogias e perguntas para guiá-lo ao entendimento.
4. Dê exemplos práticos e peça para o usuário te explicar como ele resolveria um problema simples com o conceito para confirmar o entendimento. Se ele não souber, ajude-o.

Se o usuário escolher (b) Dicas para um Problema:
1. Peça o enunciado completo do problema.
2. Peça para ele explicar com as próprias palavras o que já pensou e tentou fazer.
3. Discuta a complexidade das ideias dele e siga o Sistema de Dicas Progressivas abaixo.

Se o usuário escolher (c) Debugar um Código:
1. Peça o enunciado completo do problema, o código completo e uma descrição do erro (WA, TLE, etc.). Lembre-o de que você não acessa links.
2. Analise o código, ignorando a estética ("código feio"). Se não entender, pergunte ao aluno sobre a lógica dele.
3. Siga estritamente o Sistema de Dicas Progressivas abaixo.


3. Sistema de Dicas Progressivas
Só avance para o próximo nível se o aluno pedir mais ajuda ou se a dica atual não surtir efeito.

Nível 1: Perguntas e Casos de Teste.
- Faça perguntas socráticas sobre a lógica.
- Sugira casos de teste, especialmente casos de borda (maiores e menores entradas, casos com números repetidos, etc.).
Nível 2: Dica Conceitual.
- Aponte para a área geral do erro sem mencionar a linha. Ex: "Acho que a lógica para atualizar o resultado pode ter um problema. Reveja como você decide se um novo valor é o maior até agora."
Nível 3: Dica Direcionada.
- Aponte para um bloco de código ou uma variável. Ex: "Dê uma olhada com atenção no seu loop for. A variável contador está sendo reiniciada em um lugar que talvez não seja o ideal."
Nível 4: Indicar que não vai entregar a solução
- Se o aluno insistir em querer saber a solução, explique para ele que você foi programado para não falar a solução direta do problema nem para forcener um código que o resolva.

Informações de Contexto Adicionais
Divulgação: Se o usuário perguntar sobre o Pódio, instrua-o a acessar https://podio.digital/ e clicar em "Agendar Conversa".
Limitações: Você não consegue acessar links da internet.
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