const express = require('express');
const { CheckoutService } = require('./services/CheckoutService');

const app = express();
app.use(express.json());

const gatewayPagamentoMock = {
  cobrar: async (valor) =>
    new Promise(resolve => setTimeout(() => resolve({ status: 'APROVADO' }), 300))
};

const pedidoRepositoryMock = {
  salvar: async (pedido) => ({ ...pedido, id: Math.floor(Math.random() * 10000) })
};

const emailServiceMock = {
  enviarConfirmacao: async (email, msg) =>
    console.log(`E-mail enviado para ${email}: ${msg}`)
};

const checkoutService = new CheckoutService(
  gatewayPagamentoMock,
  pedidoRepositoryMock,
  emailServiceMock
);

function validarPayload({ clienteEmail, valor, cartao }) {
  const erros = [];
  if (!clienteEmail || !clienteEmail.includes('@')) erros.push('clienteEmail inválido');
  if (!valor || valor <= 0)                          erros.push('valor deve ser maior que zero');
  if (!cartao || !cartao.numero || !cartao.cvv)      erros.push('cartao incompleto');
  return erros;
}

app.post('/api/v1/checkout', async (req, res) => {
  const erros = validarPayload(req.body);
  if (erros.length > 0) {
    return res.status(400).json({ erro: 'Dados inválidos para checkout', detalhes: erros });
  }

  const { clienteEmail, valor, cartao } = req.body;
  const pedido = { clienteEmail, valor, cartao, status: 'PENDENTE' };

  const resultado = await checkoutService.processar(pedido);

  if (resultado && resultado.status === 'PROCESSADO') {
    return res.status(200).json({ mensagem: 'Pedido finalizado com sucesso!', pedido: resultado });
  }

  return res.status(500).json({
    erro: 'Não foi possível processar seu pagamento. Tente mais tarde.'
  });
});

app.post('/api/v1/cache/flush', (req, res) => {
  console.log('CACHE LIMPO ABRUPTAMENTE!');
  res.json({ status: 'cache_invalidated' });
});

module.exports = { app, validarPayload };

if (require.main === module) {
  const PORT = 3000;
  app.listen(PORT, () => console.log(`Servidor da EntregasJá rodando na porta ${PORT}`));
}
