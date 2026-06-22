class CheckoutService {
  constructor(gatewayPagamento, pedidoRepository, emailService) {
    this.gatewayPagamento = gatewayPagamento;
    this.pedidoRepository = pedidoRepository;
    this.emailService = emailService;
  }

  async processar(pedido) {
    try {
      const resposta = await this.gatewayPagamento.cobrar(pedido.valor, pedido.cartao);
      if (resposta.status === 'APROVADO') {
        return await this._handleAprovado(pedido);
      } else {
        return await this._handleRecusado(pedido);
      }
    } catch (error) {
      return await this._handleErroGateway(pedido, error);
    }
  }

  async _handleAprovado(pedido) {
    pedido.status = 'PROCESSADO';
    const pedidoSalvo = await this.pedidoRepository.salvar(pedido);
    this.emailService
      .enviarConfirmacao(pedido.clienteEmail, 'Pagamento Aprovado')
      .catch(err => console.error('Falha ao enviar e-mail:', err.message));
    return pedidoSalvo;
  }

  async _handleRecusado(pedido) {
    pedido.status = 'FALHOU';
    await this.pedidoRepository.salvar(pedido);
    return null;
  }

  async _handleErroGateway(pedido, error) {
    console.error('Falha catastrófica no gateway bancário:', error.message);
    pedido.status = 'ERRO_GATEWAY';
    await this.pedidoRepository.salvar(pedido);
    return null;
  }
}

module.exports = { CheckoutService };
