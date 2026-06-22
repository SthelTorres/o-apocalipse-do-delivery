# language: pt

Funcionalidade: Checkout com falha de infraestrutura
  Como operador da EntregasJá
  Quero que o sistema trate falhas do gateway com resiliência
  Para evitar colapso em cascata durante a Black Friday

  Contexto:
    Dado que o repositório de pedidos está funcionando

  Cenário: Gateway lança exceção por timeout
    Dado um pedido válido com email "cliente@email.com", valor 150.00 e cartão informado
    Quando o gateway lança uma exceção de timeout
    Então o status do pedido deve ser "ERRO_GATEWAY"
    E o pedido deve ser salvo no repositório
    E nenhum e-mail de confirmação deve ser enviado
    E a resposta deve ser nula

  Cenário: Payload inválido sem e-mail não chega ao gateway
    Dado um pedido sem e-mail informado
    Quando o checkout é processado
    Então o gateway não deve ser chamado
    E o repositório não deve ser chamado
