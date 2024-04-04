export type Success<A> = {
  readonly _tag: "Success";
  readonly value: A;
  readonly isSuccess: true;
  readonly isFailure: false;
};

export type Failure<E> = {
  readonly _tag: "Failure";
  readonly error: E;
  readonly isSuccess: false;
  readonly isFailure: true;
};

export type ResultT<E, A> = Success<A> | Failure<E>;

export const fail = <T = undefined>(error?: T) => {
  return {
    _tag: "Failure",
    error,
    isSuccess: false,
    isFailure: true,
  } as Failure<T>;
};

export const succeed = <T = undefined>(value?: T) => {
  return {
    _tag: "Success",
    value,
    isSuccess: true,
    isFailure: false,
  } as Success<T>;
};

export const all = <const E, const A>(
  results: ResultT<E, A>[]
): ResultT<E[], A[]> => {
  const failures: E[] = [];
  const successes: A[] = [];

  for (const result of results) {
    if (result.isFailure) {
      failures.push(result.error);
    } else {
      successes.push(result.value);
    }
  }

  if (failures.length > 0) {
    return fail(failures);
  } else {
    return succeed(successes);
  }
};

export const Result = {
  fail,
  succeed,
  all,
};
