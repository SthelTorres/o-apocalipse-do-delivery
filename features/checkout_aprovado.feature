# language: pt

Funcionalidade: Checkout com pagamento aprovado
  Como cliente da EntregasJá
  Quero finalizar meu pedido com cartão de crédito
  Para receber a confirmação do pagamento

  Contexto:
    Dado que o gateway de pagamento está disponível
    E o repositório de pedidos está funcionando
    E o serviço de e-mail está disponível

  Cenário: Pagamento aprovado com sucesso
    Dado um pedido válido com email "cliente@email.com", valor 150.00 e cartão informado
    Quando o checkout é processado
    Então o status do pedido deve ser "PROCESSADO"
    E o pedido deve ser salvo no repositório
    E um e-mail de confirmação deve ser enviado para "cliente@email.com"
    E a resposta deve conter o pedido salvo
