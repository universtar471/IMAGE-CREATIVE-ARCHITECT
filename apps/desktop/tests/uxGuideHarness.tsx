import { useSpendConfirm } from "../src/components/common/SpendConfirm";

export function SpendConfirmHarness({
  provider,
  submit,
}: {
  provider: string;
  submit: () => void;
}) {
  const spend = useSpendConfirm();
  const run = async () => {
    if (
      await spend.request({
        providerId: provider,
        provider,
        model: "model",
        imageCount: 1,
        estimatedTotal: 3000,
      })
    )
      submit();
  };
  return (
    <>
      <button onClick={() => void run()}>run</button>
      {spend.dialog}
    </>
  );
}
