/**
 * validarPayload.test.js
 *
 * Testa a função de validação de entrada (RF01/RN01) isolada.
 * Cobre o caminho que impede chegada ao gateway com dados inválidos.
 *
 * GFC: garante que N2 (cobrar) NUNCA é atingido com payload inválido.
 */

const { validarPayload } = require('../../src/server');

describe('validarPayload — RF01 (Validação de Entrada)', () => {

  test('deve retornar array vazio para payload completamente válido', () => {
    const erros = validarPayload({
      clienteEmail: 'cliente@email.com',
      valor: 150.00,
      cartao: { numero: '4111111111111111', validade: '12/2028', cvv: '123' }
    });

    expect(erros).toHaveLength(0);
  });

  test('deve rejeitar e-mail sem @', () => {
    const erros = validarPayload({
      clienteEmail: 'emailinvalido',
      valor: 150.00,
      cartao: { numero: '4111111111111111', validade: '12/2028', cvv: '123' }
    });

    expect(erros).toContain('clienteEmail inválido');
  });

  test('deve rejeitar e-mail ausente', () => {
    const erros = validarPayload({
      clienteEmail: null,
      valor: 150.00,
      cartao: { numero: '4111111111111111', validade: '12/2028', cvv: '123' }
    });

    expect(erros).toContain('clienteEmail inválido');
  });

  test('deve rejeitar valor zero', () => {
    const erros = validarPayload({
      clienteEmail: 'cliente@email.com',
      valor: 0,
      cartao: { numero: '4111111111111111', validade: '12/2028', cvv: '123' }
    });

    expect(erros).toContain('valor deve ser maior que zero');
  });

  test('deve rejeitar valor negativo', () => {
    const erros = validarPayload({
      clienteEmail: 'cliente@email.com',
      valor: -50,
      cartao: { numero: '4111111111111111', validade: '12/2028', cvv: '123' }
    });

    expect(erros).toContain('valor deve ser maior que zero');
  });

  test('deve rejeitar cartão ausente', () => {
    const erros = validarPayload({
      clienteEmail: 'cliente@email.com',
      valor: 150.00,
      cartao: null
    });

    expect(erros).toContain('cartao incompleto');
  });

  test('deve rejeitar cartão sem CVV', () => {
    const erros = validarPayload({
      clienteEmail: 'cliente@email.com',
      valor: 150.00,
      cartao: { numero: '4111111111111111', validade: '12/2028' }
    });

    expect(erros).toContain('cartao incompleto');
  });

  test('deve acumular múltiplos erros quando vários campos são inválidos', () => {
    const erros = validarPayload({
      clienteEmail: null,
      valor: 0,
      cartao: null
    });

    expect(erros).toHaveLength(3);
  });
});
