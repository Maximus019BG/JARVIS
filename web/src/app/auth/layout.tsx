interface Props {
  children: React.ReactNode;
  modal: React.ReactNode;
}

export default function AuthLayout({ children, modal }: Props) {
  return (
    <div>
      {children}
      {modal}
    </div>
  );
}
