import { Truck, Mail, Phone, MapPin } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-slate-900 text-white py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Logo y descripción */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                <Truck className="w-5 h-5 text-white" />
              </div>
              <span className="font-bold text-lg">LogiTrack</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              Sistema de gestión logística avanzado para el seguimiento y control de envíos en tiempo real. Conectando
              sucursales y optimizando rutas para una entrega eficiente.
            </p>
          </div>

          {/* Enlaces rápidos */}
          <div>
            <h3 className="font-semibold text-white mb-4">Enlaces Rápidos</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a href="/" className="text-slate-400 hover:text-white transition-colors">
                  Envíos
                </a>
              </li>
              <li>
                <a href="/vehicles" className="text-slate-400 hover:text-white transition-colors">
                  Flota
                </a>
              </li>
              <li>
                <a href="/branches" className="text-slate-400 hover:text-white transition-colors">
                  Sucursales
                </a>
              </li>
              <li>
                <a href="/dashboard" className="text-slate-400 hover:text-white transition-colors">
                  Dashboard
                </a>
              </li>
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h3 className="font-semibold text-white mb-4">Contacto</h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-400" />
                <span className="text-slate-400">soporte@logitrack.com</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-slate-400" />
                <span className="text-slate-400">+54 11 1234-5678</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span className="text-slate-400">Buenos Aires, Argentina</span>
              </div>
            </div>
          </div>
        </div>

        {/* Línea divisoria */}
        <div className="border-t border-slate-800 mt-8 pt-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-slate-400 text-sm">© 2024 LogiTrack. Todos los derechos reservados.</p>
            <div className="flex gap-6 text-sm">
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                Política de Privacidad
              </a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                Términos de Servicio
              </a>
              <a href="#" className="text-slate-400 hover:text-white transition-colors">
                Ayuda
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
