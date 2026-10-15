using System;
using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.InteropServices.WindowsRuntime;

// WinRT events use EventRegistrationToken, not ordinary CLR events. Keep the
// callback off PowerShell runspaces and enqueue only the four button enums.
public sealed class CwbAcceptanceMediaEvents {
  readonly ConcurrentQueue<string> buttons = new ConcurrentQueue<string>();
  PropertyInfo button;
  Delegate handler, remove;
  Type handlerType;
  public void Attach(object sender, Type projectedType) {
    EventInfo info = projectedType.GetEvent("ButtonPressed");
    handlerType = info.EventHandlerType;
    button = handlerType.GetMethod("Invoke").GetParameters()[1].ParameterType.GetProperty("Button");
    handler = Delegate.CreateDelegate(handlerType, this, GetType().GetMethod("OnButton"));
    MethodInfo addMethod = info.GetAddMethod(), removeMethod = info.GetRemoveMethod();
    Type token = addMethod.ReturnType;
    Delegate add = Delegate.CreateDelegate(typeof(Func<,>).MakeGenericType(handlerType, token), sender, addMethod);
    remove = Delegate.CreateDelegate(typeof(Action<>).MakeGenericType(token), sender, removeMethod);
    typeof(WindowsRuntimeMarshal).GetMethod("AddEventHandler").MakeGenericMethod(handlerType).Invoke(null, new object[] { add, remove, handler });
  }
  public void OnButton(object sender, object args) {
    string value = button.GetValue(args, null).ToString().ToLowerInvariant();
    if ((value == "play" || value == "pause" || value == "next" || value == "previous") && buttons.Count < 8) buttons.Enqueue(value);
  }
  public string Take() { string value; return buttons.TryDequeue(out value) ? value : null; }
  public void Detach() {
    if (handler != null) typeof(WindowsRuntimeMarshal).GetMethod("RemoveEventHandler").MakeGenericMethod(handlerType).Invoke(null, new object[] { remove, handler });
    handler = null;
  }
}
