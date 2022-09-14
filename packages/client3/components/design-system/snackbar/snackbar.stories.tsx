import { ComponentMeta, ComponentStory } from "@storybook/react";
import { toast } from "react-toastify";

import { Snackbar } from ".";
import { SnackbarType } from "./types";

export default {
  title: "FAD/Components/Snackbar",
  component: Snackbar,
} as ComponentMeta<typeof Snackbar>;

export const SnackbarStory: ComponentStory<typeof Snackbar> = (args) => {
  const notify = () => {
    toast(args.message, {
      type: args.type,
      hideProgressBar: true,
      closeOnClick: true,
    });
  };

  return (
    <>
      <button onClick={notify}>View snackbar</button>
      <Snackbar {...args} />
    </>
  );
};

SnackbarStory.args = {
  message: "Snackbar message",
  type: SnackbarType.SUCCESS,
};
