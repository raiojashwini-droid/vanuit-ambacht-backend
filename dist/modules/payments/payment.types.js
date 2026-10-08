export class PaymentError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = 'PAYMENT_ERROR') {
        super(message);
        this.name = 'PaymentError';
        this.statusCode = statusCode;
        this.code = code;
    }
}
