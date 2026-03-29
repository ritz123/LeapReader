/**
 * PDF.js 4 uses Promise.withResolvers in TextLayer and network code.
 * It is missing on many Android WebViews and older Safari — without it,
 * opening a PDF throws and the UI stays blank.
 */
type WithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const P = Promise as typeof Promise & { withResolvers?: <T>() => WithResolvers<T> };

if (typeof P.withResolvers !== "function") {
  P.withResolvers = function <T>(): WithResolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
