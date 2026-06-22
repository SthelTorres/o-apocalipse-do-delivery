# language: pt

Funcionalidade: Checkout com pagamento recusado
  Como cliente da EntregasJá
  Quero ser informado quando meu cartão for recusado
  Para tentar outro meio de pagamento

  Contexto:
    Dado que o gateway de pagamento está disponível
    E o repositório de pedidos está funcionando

  Cenário: Cartão recusado pelo gateway
    Dado um pedido válido com email "cliente@email.com", valor 150.00 e cartão informado
    Quando o gateway retorna status "RECUSADO"
    Então o status do pedido deve ser "FALHOU"
    E o pedido deve ser salvo no repositório
    E nenhum e-mail de confirmação deve ser enviado
    E a resposta deve ser nula
