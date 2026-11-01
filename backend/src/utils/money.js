export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const toPaise = (rupees) => Math.round(Number(rupees) * 100);

export const fromPaise = (paise) => roundMoney(Number(paise) / 100);

export const percentageOf = (amount, percent) => roundMoney((Number(amount) * Number(percent)) / 100);

export const clampMoney = (value, min = 0) => Math.max(min, roundMoney(value));
