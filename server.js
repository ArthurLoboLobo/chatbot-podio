// Importa o framework Express
const express = require('express');
const app = express();

// Middleware para entender o corpo das requisições em JSON
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = "podio-ajudante-token"; // Crie qualquer senha aqui

// Rota principal para testar se o servidor está no ar
app.get('/', (req, res) => {
  res.send('Servidor do Chatbot Pódio no ar!');
});

// Rota para a verificação do Webhook (handshake com a Meta)
// Documentação: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get('/whatsapp-webhook', (req, res) => {
  // Extrai os parâmetros de verificação da requisição
  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];

  // Verifica se o modo e o token estão presentes e corretos
  if (mode && token === VERIFY_TOKEN) {
    // Responde com o 'challenge' para confirmar o Webhook
    console.log("Webhook verificado com sucesso!");
    res.status(200).send(challenge);
  } else {
    // Se o token estiver incorreto, recusa a conexão
    console.log("Falha na verificação do Webhook.");
    res.sendStatus(403);
  }
});

// Rota para receber as mensagens do WhatsApp
// Documentação: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components
app.post('/whatsapp-webhook', (req, res) => {
  console.log("Recebemos uma mensagem!");
  console.log(JSON.stringify(req.body, null, 2)); // Imprime o corpo da mensagem para depuração

  // Aqui, no futuro, colocaremos a lógica para responder ao aluno

  res.sendStatus(200); // Responde ao WhatsApp que a mensagem foi recebida com sucesso
});

// Inicia o servidor para "ouvir" na porta definida
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});