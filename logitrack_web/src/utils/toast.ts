type ToastType = "success" | "error";
type AddToastFn = (type: ToastType, message: string) => void;

let _addToast: AddToastFn | null = null;

export function setAddToast(fn: AddToastFn | null) {
  _addToast = fn;
}

export function toast(type: ToastType, message: string) {
  _addToast?.(type, message);
}
toast.success = (message: string) => toast("success", message);
toast.error = (message: string) => toast("error", message);
