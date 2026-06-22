const { PedidoBuilder }   = require('../../src/builders/PedidoBuilder');
const { CheckoutService } = require('../../src/services/CheckoutService');

describe('PedidoBuilder — campos do cartão padrão (mata M1, M2, M3, M4)', () => {
  test('cartão padrão deve ter número não vazio', () => {
    const pedido = new PedidoBuilder().build();
    expect(pedido.cartao.numero).toBeTruthy();
    expect(pedido.cartao.numero.length).toBeGreaterThan(0);
  });
  test('cartão padrão deve ter validade não vazia', () => {
    const pedido = new PedidoBuilder().build();
    expect(pedido.cartao.validade).toBeTruthy();
    expect(pedido.cartao.validade.length).toBeGreaterThan(0);
  });
  test('cartão padrão deve ter CVV não vazio', () => {
    const pedido = new PedidoBuilder().build();
    expect(pedido.cartao.cvv).toBeTruthy();
    expect(pedido.cartao.cvv.length).toBeGreaterThan(0);
  });
  test('cartão padrão deve ter todas as três propriedades preenchidas', () => {
    const pedido = new PedidoBuilder().build();
    expect(pedido.cartao).toEqual(
      expect.objectContaining({
        numero:   expect.stringMatching(/.+/),
        validade: expect.stringMatching(/.+/),
        cvv:      expect.stringMatching(/.+/)
      })
    );
  });
});

describe('PedidoBuilder — comCartao() (mata NC1)', () => {
  test('comCartao deve substituir o cartão padrão pelo informado', () => {
    const cartaoCustom = { numero: '5500000000000004', validade: '06/2027', cvv: '321' };
    const pedido = new PedidoBuilder().comCartao(cartaoCustom).build();
    expect(pedido.cartao).toEqual(cartaoCustom);
    expect(pedido.cartao.numero).toBe('5500000000000004');
  });
  test('comCartao não deve afetar os outros campos do pedido', () => {
    const cartaoCustom = { numero: '5500000000000004', validade: '06/2027', cvv: '321' };
    const pedido = new PedidoBuilder().comCartao(cartaoCustom).build();
    expect(pedido.clienteEmail).toBe('cliente@entregasja.com');
    expect(pedido.valor).toBe(100.00);
  });
});

describe('PedidoBuilder — semValor() (mata NC2)', () => {
  test('semValor deve definir valor como null', () => {
    const pedido = new PedidoBuilder().semValor().build();
    expect(pedido.valor).toBeNull();
  });
  test('semValor não deve afetar os outros campos do pedido', () => {
    const pedido = new PedidoBuilder().semValor().build();
    expect(pedido.clienteEmail).toBe('cliente@entregasja.com');
    expect(pedido.cartao).toBeDefined();
  });
});

describe('CheckoutService — tratamento de falha no e-mail (mata M5)', () => {
  test('deve logar erro quando o envio de e-mail falha, sem derrubar o fluxo', async () => {
    const erroEmail = new Error('SMTP indisponível');
    const gateway    = { cobrar: jest.fn().mockResolvedValue({ status: 'APROVADO' }) };
    const repository = { salvar: jest.fn().mockImplementation(async p => ({ ...p, id: 1 })) };
    const emailService = { enviarConfirmacao: jest.fn().mockRejectedValue(erroEmail) };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new CheckoutService(gateway, repository, emailService);
    const pedido  = new PedidoBuilder().comEmail('cliente@email.com').build();
    const resultado = await service.processar(pedido);
    await new Promise(resolve => setImmediate(resolve));
    expect(resultado).not.toBeNull();
    expect(resultado.status).toBe('PROCESSADO');
    expect(consoleSpy).toHaveBeenCalledWith('Falha ao enviar e-mail:', erroEmail.message);
    consoleSpy.mockRestore();
  });
});

describe('CheckoutService — mensagem de erro do gateway (mata M6)', () => {
  test('deve logar mensagem específica quando o gateway falha', async () => {
    const erroGateway = new Error('connection refused');
    const gateway    = { cobrar: jest.fn().mockRejectedValue(erroGateway) };
    const repository = { salvar: jest.fn().mockImplementation(async p => ({ ...p, id: 1 })) };
    const emailService = { enviarConfirmacao: jest.fn() };
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = new CheckoutService(gateway, repository, emailService);
    const pedido  = new PedidoBuilder().build();
    await service.processar(pedido);
    expect(consoleSpy).toHaveBeenCalledWith('Falha catastrófica no gateway bancário:', erroGateway.message);
    const [primeiroArg] = consoleSpy.mock.calls[0];
    expect(primeiroArg.length).toBeGreaterThan(0);
    consoleSpy.mockRestore();
  });
});
