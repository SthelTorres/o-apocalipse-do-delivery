class PedidoBuilder {
  constructor() {
    this._clienteEmail = 'cliente@entregasja.com';
    this._valor = 100.00;
    this._cartao = { numero: '4111111111111111', validade: '12/2028', cvv: '123' };
    this._status = 'PENDENTE';
  }
  comEmail(email) { this._clienteEmail = email; return this; }
  comValor(valor) { this._valor = valor; return this; }
  comCartao(cartao) { this._cartao = cartao; return this; }
  semEmail() { this._clienteEmail = null; return this; }
  semCartao() { this._cartao = null; return this; }
  semValor() { this._valor = null; return this; }
  build() {
    return {
      clienteEmail: this._clienteEmail,
      valor: this._valor,
      cartao: this._cartao,
      status: this._status
    };
  }
}
module.exports = { PedidoBuilder };
