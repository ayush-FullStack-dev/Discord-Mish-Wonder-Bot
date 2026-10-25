import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  SeparatorBuilder,
  type InteractionReplyOptions,
} from "discord.js";

export interface ConfirmedOrderData {
  id: string;
  status: string;
  tracking: string | null;
  restaurant: string;
}

interface ConfirmedOrderPanelOptions {
  order: ConfirmedOrderData;
}

export function createConfirmedOrderPanel({
  order,
}: ConfirmedOrderPanelOptions): InteractionReplyOptions {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "## <a:order_placed:1563814138025742367> Order Successfully Placed",
          `Your order from **${order.restaurant}** is confirmed. \n`,
        ].join("\n"),
      ),
    )

  if (order.tracking) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          [
            "<a:FoodDeliverybike1:1564011957105856513>   Track Your Order",
            `[View Live Tracking →](${order.tracking}) \n`,
          ].join("          "),
        ),
      );
  }

  container
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "-# Thank you for your order!",
      ),
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}
