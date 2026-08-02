/**
 * Ready-made connector settings per exchange, so only the API key has to be typed.
 *
 * Wallex (https://api.wallex.ir) — verified against the live API:
 *   GET  /v1/account/balances  → {result:{balances:{USDT:{value,locked},TMN:{…}}}}
 *   POST /v1/account/orders    → {symbol,type,side,price,quantity}
 * Both read the `x-api-key` header; without it they answer 401 "authorization
 * header is missing", with a malformed one 401 "invalid API key format".
 */

export type WalletPreset = {
  id: string;
  label: string;
  values: {
    label: string;
    asset: string;
    exchange: string;
    method: string;
    url: string;
    headerName: string;
    jsonPath: string;
    multiplier: string;
    body: string;
  };
};

export type TradePreset = {
  id: string;
  label: string;
  values: {
    label: string;
    exchange: string;
    asset: string;
    method: string;
    url: string;
    headerName: string;
    bodyTemplate: string;
    buyValue: string;
    sellValue: string;
  };
};

const WALLEX_BALANCES = "https://api.wallex.ir/v1/account/balances";
const WALLEX_ORDERS = "https://api.wallex.ir/v1/account/orders";

export const WALLET_PRESETS: WalletPreset[] = [
  {
    id: "wallex-usdt",
    label: "والکس — تتر",
    values: {
      label: "والکس — تتر",
      asset: "usdt",
      exchange: "wallex",
      method: "GET",
      url: WALLEX_BALANCES,
      headerName: "x-api-key",
      jsonPath: "result.balances.USDT.value",
      multiplier: "1",
      body: "",
    },
  },
  {
    id: "wallex-tmn",
    label: "والکس — تومان",
    values: {
      label: "والکس — موجودی تومانی",
      asset: "toman",
      exchange: "wallex",
      method: "GET",
      url: WALLEX_BALANCES,
      headerName: "x-api-key",
      jsonPath: "result.balances.TMN.value",
      multiplier: "1",
      body: "",
    },
  },
];

export const TRADE_PRESETS: TradePreset[] = [
  {
    id: "wallex-usdttmn",
    label: "والکس — USDT/TMN",
    values: {
      label: "والکس — سفارش تتر",
      exchange: "wallex",
      asset: "usdt",
      method: "POST",
      url: WALLEX_ORDERS,
      headerName: "x-api-key",
      // Wallex wants strings for price/quantity and upper-case sides.
      bodyTemplate:
        '{"symbol":"USDTTMN","type":"LIMIT","side":"{{side}}","price":"{{price}}","quantity":"{{qty}}"}',
      buyValue: "BUY",
      sellValue: "SELL",
    },
  },
];
